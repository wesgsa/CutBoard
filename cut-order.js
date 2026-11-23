/*
 * 배치 결과를 단계별 절단 순서로 변환합니다.
 *
 * 사용법:
 *   const result = computeCutOrder(layout, boards, pieces, {
 *       guillotine: true,
 *       edge_margin: 0,
 *       kerf: 0
 *   });
 *
 * 결과:
 *   { success, mode, steps, uncutPieces, reason }
 *
 * 길로틴 모드는 매번 현재 판 영역을 가로 또는 세로로 완전히 가르는
 * 재귀 분할 순서를 만듭니다. 일반 모드는 각 조각의 네 경계를 보여주는
 * 시각화용 순서입니다. 일반 모드는 길로틴 절단 가능성을 보장하지 않습니다.
 */
(function (root) {
    'use strict';

    function getNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function findById(items, id) {
        return items.find(item => String(item.id) === String(id));
    }

    function getBoardRect(board, options) {
        const margin = Math.max(0, getNumber(options.edge_margin, 0));
        return {
            left: margin,
            top: margin,
            right: getNumber(board.width, 0) - margin,
            bottom: getNumber(board.height, 0) - margin
        };
    }

    function getPlacementsOnBoard(layout, boardPlacement) {
        return layout
            .filter(item =>
                String(item.board_id) === String(boardPlacement.board_id) &&
                Number(item.board_copy_index || 0) === Number(boardPlacement.board_copy_index || 0)
            )
            .map(item => ({
                ...item,
                left: getNumber(item.x, 0),
                top: getNumber(item.y, 0),
                right: getNumber(item.x, 0) + getNumber(item.width, 0),
                bottom: getNumber(item.y, 0) + getNumber(item.height, 0)
            }));
    }

    function makeStep(boardPlacement, piece, axis, position, from, to, label, type) {
        return {
            type: type || 'cut',
            axis,
            position,
            from,
            to,
            piece_id: piece.piece_id,
            board_id: boardPlacement.board_id,
            board_copy_index: Number(boardPlacement.board_copy_index || 0),
            piece_rotated: Boolean(piece.piece_rotated),
            label
        };
    }

    // 일반 모드: 조각의 위, 오른쪽, 아래, 왼쪽 경계를 차례로 표시합니다.
    function makeFreeCutSteps(boardPlacement, placements) {
        const steps = [];

        for (const piece of placements) {
            const width = piece.right - piece.left;
            const height = piece.bottom - piece.top;
            const cutList = [
                { axis: 'horizontal', position: piece.top, from: piece.left, to: piece.right, side: '위쪽' },
                { axis: 'vertical', position: piece.right, from: piece.top, to: piece.bottom, side: '오른쪽' },
                { axis: 'horizontal', position: piece.bottom, from: piece.left, to: piece.right, side: '아래쪽' },
                { axis: 'vertical', position: piece.left, from: piece.top, to: piece.bottom, side: '왼쪽' }
            ];

            for (const cut of cutList) {
                steps.push(makeStep(
                    boardPlacement,
                    piece,
                    cut.axis,
                    cut.position,
                    cut.from,
                    cut.to,
                    `${piece.width} × ${piece.height} 조각 ${cut.side} 절단`
                ));
            }
        }

        return steps;
    }

    function getSplitCandidates(region, placements, kerf) {
        const candidates = [];

        for (const piece of placements) {
            for (const position of [piece.left, piece.right]) {
                if (position > region.left && position < region.right) {
                    candidates.push({ axis: 'vertical', position, kerf });
                }
            }
            for (const position of [piece.top, piece.bottom]) {
                if (position > region.top && position < region.bottom) {
                    candidates.push({ axis: 'horizontal', position, kerf });
                }
            }
        }

        // 가장자리에서 가까운 절단부터 시도해 순서가 일정하게 나오게 합니다.
        candidates.sort((a, b) => {
            const aDistance = a.axis === 'vertical'
                ? Math.abs(a.position - region.left)
                : Math.abs(a.position - region.top);
            const bDistance = b.axis === 'vertical'
                ? Math.abs(b.position - region.left)
                : Math.abs(b.position - region.top);
            return aDistance - bDistance || a.axis.localeCompare(b.axis) || a.position - b.position;
        });

        return candidates;
    }

    function splitPlacements(region, placements, split) {
        const epsilon = 1e-7;
        const low = [];
        const high = [];

        for (const piece of placements) {
            if (split.axis === 'vertical') {
                if (piece.right <= split.position + epsilon) low.push(piece);
                else if (piece.left >= split.position - epsilon) high.push(piece);
                else return null;
            } else {
                if (piece.bottom <= split.position + epsilon) low.push(piece);
                else if (piece.top >= split.position - epsilon) high.push(piece);
                else return null;
            }
        }

        if (!low.length || !high.length) return null;
        return { low, high };
    }

    function makeGuillotineSteps(boardPlacement, boardRect, placements, kerf) {
        const steps = [];

        function visit(region, items) {
            if (items.length <= 1) return true;

            for (const split of getSplitCandidates(region, items, kerf)) {
                const groups = splitPlacements(region, items, split);
                if (!groups) continue;

                const representative = groups.low[groups.low.length - 1];
                const from = split.axis === 'vertical' ? region.top : region.left;
                const to = split.axis === 'vertical' ? region.bottom : region.right;
                const label = split.axis === 'vertical'
                    ? `세로 절단 · 위치 ${split.position} mm`
                    : `가로 절단 · 위치 ${split.position} mm`;

                const step = makeStep(
                    boardPlacement,
                    representative,
                    split.axis,
                    split.position,
                    from,
                    to,
                    label,
                    'guillotine'
                );

                const lowRegion = split.axis === 'vertical'
                    ? { ...region, right: split.position }
                    : { ...region, bottom: split.position };
                const highRegion = split.axis === 'vertical'
                    ? { ...region, left: split.position }
                    : { ...region, top: split.position };

                // 자른 뒤 두 영역 안쪽의 절단을 이어서 기록합니다.
                const start = steps.length;
                steps.push(step);
                if (visit(lowRegion, groups.low) && visit(highRegion, groups.high)) return true;
                steps.length = start;
            }

            return false;
        }

        const success = visit(boardRect, placements);
        return { success, steps };
    }

    function computeCutOrder(layout, boards, pieces, options) {
        options = options || {};
        const steps = [];
        const uncutPieces = [];
        const boardPlacements = [];
        const seenBoards = new Set();

        for (const placement of layout) {
            const key = `${placement.board_id}:${Number(placement.board_copy_index || 0)}`;
            if (seenBoards.has(key)) continue;
            seenBoards.add(key);
            boardPlacements.push(placement);
        }

        for (const boardPlacement of boardPlacements) {
            const board = findById(boards, boardPlacement.board_id);
            if (!board) {
                return {
                    success: false,
                    mode: options.guillotine ? 'guillotine' : 'free',
                    steps,
                    uncutPieces: layout.slice(),
                    reason: `원자재 ID ${boardPlacement.board_id}를 찾을 수 없습니다.`
                };
            }

            const placements = getPlacementsOnBoard(layout, boardPlacement);
            const boardRect = getBoardRect(board, options);

            for (const placed of placements) {
                const piece = findById(pieces, placed.piece_id);
                if (!piece) {
                    return {
                        success: false,
                        mode: options.guillotine ? 'guillotine' : 'free',
                        steps,
                        uncutPieces: placements,
                        reason: `조각 ID ${placed.piece_id}를 찾을 수 없습니다.`
                    };
                }
                placed.width = placed.width || (placed.piece_rotated ? piece.height : piece.width);
                placed.height = placed.height || (placed.piece_rotated ? piece.width : piece.height);
            }

            if (!options.guillotine) {
                steps.push(...makeFreeCutSteps(boardPlacement, placements));
                continue;
            }

            const result = makeGuillotineSteps(
                boardPlacement,
                boardRect,
                placements,
                Math.max(0, getNumber(options.kerf, 0))
            );

            if (!result.success) {
                uncutPieces.push(...placements.map(item => ({
                    board_id: item.board_id,
                    board_copy_index: item.board_copy_index,
                    piece_id: item.piece_id
                })));
            } else {
                steps.push(...result.steps);
            }
        }

        return {
            success: uncutPieces.length === 0,
            mode: options.guillotine ? 'guillotine' : 'free',
            steps,
            uncutPieces,
            reason: uncutPieces.length
                ? '이 배치에서는 모든 조각을 길로틴 절단으로 분리할 수 있는 순서를 찾지 못했습니다.'
                : null
        };
    }

    root.computeCutOrder = computeCutOrder;
    if (typeof module !== 'undefined' && module.exports) module.exports = { computeCutOrder };
})(typeof globalThis !== 'undefined' ? globalThis : this);
