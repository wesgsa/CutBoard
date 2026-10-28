
function findInitialLayout(boards, pieces, options = {}) {
    const allowRotation = Boolean(options.allow_rotation);

    // BSSF(Best Short Side Fit)에 따라 가능한 배치를 찾습니다.
    // 빈 공간은 { left, right, top, bottom, id } 경계 좌표로 관리합니다.
    const spaces = [];
    for (const board of boards) {
        if (board.width > 0 && board.height > 0) {
            spaces.push({
                left: 0,
                right: board.width,
                top: 0,
                bottom: board.height,
                id: board.id
            });
        }
    }

    const layouts = [];
    // 입력 배열 자체의 순서는 바꾸지 않습니다.
    const sortedPieces = [...pieces].sort((a, b) => b.width * b.height - a.width * a.height);

    for (const piece of sortedPieces) {
        let bestSpaceIndex = -1;
        let bestScore = Infinity;
        let bestRotated = false;
        let bestWidth = piece.width;
        let bestHeight = piece.height;

        for (let i = 0; i < spaces.length; i++) {
            const space = spaces[i];
            const spaceWidth = space.right - space.left;
            const spaceHeight = space.bottom - space.top;

            if (piece.width <= spaceWidth && piece.height <= spaceHeight) {
                const score = Math.min(spaceWidth - piece.width, spaceHeight - piece.height);
                if (score < bestScore) {
                    bestScore = score;
                    bestSpaceIndex = i;
                    bestRotated = false;
                    bestWidth = piece.width;
                    bestHeight = piece.height;
                }
            }

            if (allowRotation && piece.height <= spaceWidth && piece.width <= spaceHeight) {
                const score = Math.min(spaceWidth - piece.height, spaceHeight - piece.width);
                if (score < bestScore) {
                    bestScore = score;
                    bestSpaceIndex = i;
                    bestRotated = true;
                    bestWidth = piece.height;
                    bestHeight = piece.width;
                }
            }
        }

        // 들어갈 수 있는 공간이 없으면 이 조각은 미배치 상태로 둡니다.
        if (bestSpaceIndex === -1) continue;

        const bestSpace = spaces[bestSpaceIndex];
        const pieceRect = {
            left: bestSpace.left,
            right: bestSpace.left + bestWidth,
            top: bestSpace.top,
            bottom: bestSpace.top + bestHeight
        };

        layouts.push({
            x: pieceRect.left,
            y: pieceRect.top,
            board_id: bestSpace.id,
            piece_id: piece.id,
            rotation: bestRotated
        });

        // 배치된 조각과 겹치는 여유 공간을 네 방향 후보로 나눕니다.
        const splitSpaces = [];
        for (const space of spaces) {
            const intersects = pieceRect.left < space.right && pieceRect.right > space.left &&
                pieceRect.top < space.bottom && pieceRect.bottom > space.top;

            if (!intersects) {
                splitSpaces.push(space);
                continue;
            }

            const candidates = [
                { left: space.left, right: pieceRect.left, top: space.top, bottom: space.bottom },
                { left: pieceRect.right, right: space.right, top: space.top, bottom: space.bottom },
                { left: space.left, right: space.right, top: space.top, bottom: pieceRect.top },
                { left: space.left, right: space.right, top: pieceRect.bottom, bottom: space.bottom }
            ];

            for (const candidate of candidates) {
                if (candidate.right > candidate.left && candidate.bottom > candidate.top) {
                    splitSpaces.push({ ...candidate, id: space.id });
                }
            }
        }

        // 다른 여유 공간에 완전히 포함되는 공간과 중복 공간을 제거합니다.
        spaces.length = 0;
        for (let i = 0; i < splitSpaces.length; i++) {
            const current = splitSpaces[i];
            let redundant = false;

            for (let j = 0; j < splitSpaces.length; j++) {
                if (i === j) continue;
                const other = splitSpaces[j];
                const sameBounds = current.left === other.left && current.right === other.right &&
                    current.top === other.top && current.bottom === other.bottom;
                const contained = other.left <= current.left && other.right >= current.right &&
                    other.top <= current.top && other.bottom >= current.bottom;

                if (contained && (!sameBounds || j < i)) {
                    redundant = true;
                    break;
                }
            }

            if (!redundant) spaces.push(current);
        }
    }

    return layouts;
}
function OptimizePlacement(boards, pieces, options) {
    return findInitialLayout(boards, pieces, options)
}