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
            piece_id: piece ? piece.piece_id : null,
            piece_copy_index: piece ? Number(piece.piece_copy_index || 0) : null,
            board_id: boardPlacement.board_id,
            board_copy_index: Number(boardPlacement.board_copy_index || 0),
            piece_rotated: Boolean(piece && piece.piece_rotated),
            label
        };
    }

    function pieceKey(piece) {
        return `${piece.piece_id}:${Number(piece.piece_copy_index || 0)}`;
    }

    // 일반 모드: 한 단계마다 조각 하나가 판에서 분리되는 결과를 만듭니다.
    function makeFreeCutSteps(boardPlacement, boardRect, placements) {
        const steps = [];

        const candidates = [];
        const addAlignedGroups = (axis, keyA, keyB) => {
            const rows = new Map();
            for (const piece of placements) {
                const key = `${piece[keyA]}:${piece[keyB]}`;
                if (!rows.has(key)) rows.set(key, []);
                rows.get(key).push(piece);
            }
            for (const group of rows.values()) {
                if (group.length < 2) continue;
                const rect = {
                    left: Math.min(...group.map(piece => piece.left)),
                    top: Math.min(...group.map(piece => piece.top)),
                    right: Math.max(...group.map(piece => piece.right)),
                    bottom: Math.max(...group.map(piece => piece.bottom))
                };
                const groupKeys = new Set(group.map(pieceKey));
                const blocked = placements.some(piece =>
                    !groupKeys.has(pieceKey(piece)) &&
                    piece.left < rect.right && piece.right > rect.left &&
                    piece.top < rect.bottom && piece.bottom > rect.top
                );
                if (!blocked) candidates.push({ axis, group, rect });
            }
        };

        addAlignedGroups('row', 'top', 'bottom');
        addAlignedGroups('column', 'left', 'right');
        candidates.sort((a, b) => b.group.length - a.group.length ||
            ((a.rect.right - a.rect.left) * (a.rect.bottom - a.rect.top)) -
            ((b.rect.right - b.rect.left) * (b.rect.bottom - b.rect.top)));

        const groups = [];
        const used = new Set();
        for (const candidate of candidates) {
            if (candidate.group.some(piece => used.has(pieceKey(piece)))) continue;
            const groupKeys = new Set(candidate.group.map(pieceKey));
            const blockedByRemaining = placements.some(piece =>
                !groupKeys.has(pieceKey(piece)) && !used.has(pieceKey(piece)) &&
                piece.left < candidate.rect.right && piece.right > candidate.rect.left &&
                piece.top < candidate.rect.bottom && piece.bottom > candidate.rect.top
            );
            if (blockedByRemaining) continue;
            groups.push(candidate);
            candidate.group.forEach(piece => used.add(pieceKey(piece)));
        }

        for (const piece of placements) {
            if (!used.has(pieceKey(piece))) {
                groups.push({
                    axis: 'piece',
                    group: [piece],
                    rect: { left: piece.left, top: piece.top, right: piece.right, bottom: piece.bottom }
                });
            }
        }

        for (const operation of groups) {
            const group = operation.group;
            const rect = operation.rect;
            const width = rect.right - rect.left;
            const height = rect.bottom - rect.top;
            const piece = group.length === 1 ? group[0] : null;
            const step = makeStep(
                boardPlacement,
                piece,
                operation.axis,
                null,
                null,
                null,
                `${group.length}개 조각 묶음 ${width} × ${height} mm 분리`,
                'free-group'
            );
            step.active_region = { ...boardRect };
            step.detached_rect = {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width,
                height
            };
            step.active_piece_keys = group.map(pieceKey);
            step.detached_piece_keys = group.map(pieceKey);
            step.group_count = group.length;
            steps.push(step);
        }

        return steps;
    }

    function makeOptimizedFreeSteps(boardPlacement, boardRect, placements, kerf) {
        const sliced = makeGuillotineSteps(boardPlacement, boardRect, placements, kerf);
        if (sliced.success) {
            for (const step of sliced.steps) {
                step.type = 'free-slice';
                step.label = `직선 분할 · ${step.axis === 'vertical' ? '세로' : '가로'} · ${step.position} mm`;
            }
            return sliced.steps;
        }

        // 직선 분할로 전체를 나눌 수 없는 일반 배치는 같은 줄/열의
        // 조각을 한 묶음으로 정리한 뒤 나머지 조각을 처리합니다.
        return makeFreeCutSteps(boardPlacement, boardRect, placements);
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

        if (!low.length && !high.length) return null;
        return { low, high };
    }

    function makeGuillotineSteps(boardPlacement, boardRect, placements, kerf) {
        const steps = [];
        let visitedNodes = 0;
        const searchLimit = 12000;

        function visit(region, items) {
            visitedNodes++;
            if (visitedNodes > searchLimit) return false;
            if (!items.length) return true;
            if (items.length === 1) {
                const piece = items[0];
                const epsilon = 1e-7;
                if (Math.abs(region.left - piece.left) < epsilon &&
                    Math.abs(region.right - piece.right) < epsilon &&
                    Math.abs(region.top - piece.top) < epsilon &&
                    Math.abs(region.bottom - piece.bottom) < epsilon) return true;
            }

            const rankedSplits = getSplitCandidates(region, items, kerf)
                .map(split => {
                    const groups = splitPlacements(region, items, split);
                    if (!groups) return null;
                    const area = group => group.reduce((sum, piece) =>
                        sum + Math.max(0, piece.right - piece.left) * Math.max(0, piece.bottom - piece.top), 0);
                    const lowArea = area(groups.low);
                    const highArea = area(groups.high);
                    const totalArea = Math.max(1, lowArea + highArea);
                    const balance = groups.low.length && groups.high.length
                        ? Math.abs(lowArea - highArea) / totalArea
                        : 2;
                    const cutLength = split.axis === 'vertical'
                        ? region.bottom - region.top
                        : region.right - region.left;
                    const score = balance + cutLength / Math.max(region.right - region.left, region.bottom - region.top, 1) * .05;
                    return { split, score };
                })
                .filter(Boolean)
                .sort((a, b) => a.score - b.score || a.split.position - b.split.position);

            for (const ranked of rankedSplits) {
                const split = ranked.split;
                const groups = splitPlacements(region, items, split);
                if (!groups) continue;

                const from = split.axis === 'vertical' ? region.top : region.left;
                const to = split.axis === 'vertical' ? region.bottom : region.right;
                const label = split.axis === 'vertical'
                    ? `세로 절단 · 왼쪽 경계에서 ${split.position} mm`
                    : `가로 절단 · 위쪽 경계에서 ${split.position} mm`;

                const step = makeStep(
                    boardPlacement,
                    null,
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

                step.active_region = { ...region };
                step.active_piece_keys = items.map(pieceKey);
                step.result_regions = [
                    { ...lowRegion, piece_keys: groups.low.map(pieceKey) },
                    { ...highRegion, piece_keys: groups.high.map(pieceKey) }
                ];

                // 자른 뒤 두 영역 안쪽의 절단을 이어서 기록합니다.
                const start = steps.length;
                steps.push(step);
                const lowSuccess = groups.low.length ? visit(lowRegion, groups.low) : true;
                const highSuccess = groups.high.length ? visit(highRegion, groups.high) : true;
                if (lowSuccess && highSuccess) return true;
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
                steps.push(...makeOptimizedFreeSteps(
                    boardPlacement,
                    boardRect,
                    placements,
                    Math.max(0, getNumber(options.kerf, 0))
                ));
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
