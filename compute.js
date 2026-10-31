
function createBoardSpaces(boards, edgeMargin = 0) {
    return boards.flatMap((board, boardKey) => {
        const width = Number(board.width);
        const height = Number(board.height);
        if (width <= edgeMargin * 2 || height <= edgeMargin * 2) return [];
        return [{
            left: edgeMargin,
            right: width - edgeMargin,
            top: edgeMargin,
            bottom: height - edgeMargin,
            board_id: board.id,
            board_key: boardKey
        }];
    });
}

function findBestPlacement(piece, spaces, allowRotation) {
    let best = null;

    for (let i = 0; i < spaces.length; i++) {
        const space = spaces[i];
        const spaceWidth = space.right - space.left;
        const spaceHeight = space.bottom - space.top;
        const orientations = [{ width: Number(piece.width), height: Number(piece.height), rotated: false }];

        if (allowRotation && Number(piece.width) !== Number(piece.height)) {
            orientations.push({ width: Number(piece.height), height: Number(piece.width), rotated: true });
        }

        for (const orientation of orientations) {
            if (orientation.width > spaceWidth || orientation.height > spaceHeight) continue;

            const score = Math.min(spaceWidth - orientation.width, spaceHeight - orientation.height);
            if (!best || score < best.score) {
                best = { spaceIndex: i, score, ...orientation };
            }
        }
    }

    return best;
}

function rectanglesIntersect(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function createClearanceRect(pieceRect, board, kerf) {
    const halfKerf = kerf / 2;
    return {
        left: Math.max(0, pieceRect.left - halfKerf),
        right: Math.min(Number(board.width), pieceRect.right + halfKerf),
        top: Math.max(0, pieceRect.top - halfKerf),
        bottom: Math.min(Number(board.height), pieceRect.bottom + halfKerf)
    };
}

function splitSpaceAroundRect(space, obstacle) {
    if (!rectanglesIntersect(space, obstacle)) return [space];

    const candidates = [
        { left: space.left, right: obstacle.left, top: space.top, bottom: space.bottom },
        { left: obstacle.right, right: space.right, top: space.top, bottom: space.bottom },
        { left: space.left, right: space.right, top: space.top, bottom: obstacle.top },
        { left: space.left, right: space.right, top: obstacle.bottom, bottom: space.bottom }
    ];

    return candidates
        .filter(rect => rect.right > rect.left && rect.bottom > rect.top)
        .map(rect => ({ ...rect, board_id: space.board_id, board_key: space.board_key }));
}

function splitSpacesForPlacement(spaces, obstacle, boardKey) {
    return spaces.flatMap(space => space.board_key === boardKey
        ? splitSpaceAroundRect(space, obstacle)
        : [space]);
}

function rectangleArea(rect) {
    return (rect.right - rect.left) * (rect.bottom - rect.top);
}

function containsRectangle(container, candidate) {
    return container.left <= candidate.left && container.right >= candidate.right &&
        container.top <= candidate.top && container.bottom >= candidate.bottom;
}

function removeContainedSpaces(spaces) {
    const spacesByBoard = new Map();

    for (const space of spaces) {
        if (!spacesByBoard.has(space.board_key)) {
            spacesByBoard.set(space.board_key, []);
        }
        
        spacesByBoard.get(space.board_key).push(space);
    }

    const result = [];
    for (const boardSpaces of spacesByBoard.values()) {
        // 큰 사각형부터 비교하면 이미 처리한 공간만 검사하면 됩니다.
        boardSpaces.sort((a, b) => rectangleArea(b) - rectangleArea(a));
        const kept = [];

        for (const candidate of boardSpaces) {
            const contained = kept.some(container => containsRectangle(container, candidate));
            if (!contained) kept.push(candidate);
        }

        result.push(...kept);
    }

    return result;
}

function makePlacement(space, piece, candidate) {
    return {
        x: space.left,
        y: space.top,
        board_id: space.board_id,
        piece_id: piece.id,
        rotation: candidate.rotated
    };
}

function findInitialLayout(boards, pieces, options = {}) {
    const allowRotation = Boolean(options.allow_rotation);
    const kerf          = Math.max(0, Number(options.kerf) || 0);
    const edgeMargin    = Math.max(0, Number(options.edge_margin) || 0);
    const boardByKey    = new Map(boards.map((board, index) => [index, board]));

    let spaces          = createBoardSpaces(boards, edgeMargin);
    const sortedPieces  = [...pieces].sort((a, b) => Number(b.width) * Number(b.height) - Number(a.width) * Number(a.height));
    const layout        = [];

    for (const piece of sortedPieces) {
        const candidate = findBestPlacement(piece, spaces, allowRotation);
        
        if (!candidate) {
            continue;
        }

        const space = spaces[candidate.spaceIndex];
        const board = boardByKey.get(space.board_key);
        const pieceRect = {
            left: space.left, right: space.left + candidate.width,
             top: space.top, bottom: space.top + candidate.height
        };

        layout.push(makePlacement(space, piece, candidate));

        const clearanceRect = createClearanceRect(pieceRect, board, kerf);
        
        spaces = splitSpacesForPlacement(spaces, clearanceRect, space.board_key);
        spaces = removeContainedSpaces(spaces);
    }

    return layout;
}

function OptimizePlacement(boards, pieces, options) {
    return findInitialLayout(boards, pieces, options);
}
