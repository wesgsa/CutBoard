
// corner : topleft, topright, bottomleft, bottomright

function RectIntersect(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function RectArea(a) {
    return (a.right - a.left) * (a.bottom - a.top);
}

function SizeToRect(a) {
    return { left : a.x, right : a.x + a.width, top : a.y, bottom : a.y + a.height };
}

function SpaceContains(container, candidate) {
    return container.id == candidate.id &&
        container.left <= candidate.left && container.right >= candidate.right &&
        container.top <= candidate.top && container.bottom >= candidate.bottom;
}

function CanReplaceSpace(container, candidate) {
    if (!SpaceContains(container, candidate)) {
        return false;
    }

    const corners = [
        ['topleft', container.left == candidate.left && container.top == candidate.top],
        ['topright', container.right == candidate.right && container.top == candidate.top],
        ['bottomleft', container.left == candidate.left && container.bottom == candidate.bottom],
        ['bottomright', container.right == candidate.right && container.bottom == candidate.bottom]
    ];

    for (const [name, same_position] of corners) {
        if (candidate[name] && (!same_position || !container[name])) {
            return false;
        }
    }

    return true;
}

function RemoveDuplicateSpaces(spaces) {
    const sorted_spaces = [...spaces].sort((a, b) => RectArea(b) - RectArea(a));
    const unique_spaces = [];

    for (const space of sorted_spaces) {
        let is_contained = false;

        for (const larger_space of unique_spaces) {
            if (CanReplaceSpace(larger_space, space)) {
                is_contained = true;
                break;
            }
        }

        if (!is_contained) {
            unique_spaces.push(space);
        }
    }

    return unique_spaces;
}

function SplitNode(node, layout, piece_index) {
    
    let new_pieces = [];
    let new_spaces = [];
    const piece_rect = SizeToRect(layout);

    for (let index = 0; index < node.unplaced_pieces.length; index++) {
        if (index == piece_index) {
            continue;
        }

        new_pieces.push({ ...node.unplaced_pieces[index] });
    }

    const board = node.boards.find(item => item.id == layout.board_id);
    const kerf = node.kerf || 0;
    piece_rect.left = Math.max(0, layout.x - kerf);
    piece_rect.right = Math.min(board.width, layout.x + layout.width + kerf);
    piece_rect.top = Math.max(0, layout.y - kerf);
    piece_rect.bottom = Math.min(board.height, layout.y + layout.height + kerf);

    for (const space of node.spaces) {
        if (space.id != layout.board_id) {
            new_spaces.push({ ...space });
            continue;
        }

        if (RectIntersect(space, piece_rect)) {

            const left = space.left < piece_rect.left;
            const right = space.right > piece_rect.right;
            const top = space.top < piece_rect.top;
            const bottom = space.bottom > piece_rect.bottom;

            if (left) new_spaces.push({ ...space, right : piece_rect.left, topright : !top, bottomright : !bottom });
            if (right) new_spaces.push({ ...space, left : piece_rect.right, topleft : !top, bottomleft : !bottom });
            if (top) new_spaces.push({ ...space, bottom : piece_rect.top, bottomleft : !left, bottomright : !right });
            if (bottom) new_spaces.push({ ...space, top : piece_rect.bottom, topleft : !left, topright : !right });
        }

        else {
            new_spaces.push({ ...space });
        }
    }   

    const next_node = {
        ...node,
        unplaced_pieces : new_pieces,
        spaces : RemoveDuplicateSpaces(new_spaces),
        layout : [ ...node.layout, { ...layout } ]
    };

    return next_node;
}

function ExpandNode(node, options) {
    if (node.unplaced_pieces.length == 0) {
        return [];
    }

    const children = [];
    const allow_rotation = Boolean(options.allow_rotation ?? options.allowRotation);

    for (let piece_index = 0; piece_index < node.unplaced_pieces.length; piece_index++) {
        const piece = node.unplaced_pieces[piece_index];
        const rotation_count = allow_rotation && piece.width != piece.height ? 2 : 1;

        for (const space of node.spaces) {
            const space_width = space.right - space.left;
            const space_height = space.bottom - space.top;

            for (let rotation = 0; rotation < rotation_count; rotation++) {
                const width = rotation == 0 ? piece.width : piece.height;
                const height = rotation == 0 ? piece.height : piece.width;

                if (width > space_width || height > space_height) {
                    continue;
                }

                const layout = {
                    board_id : space.id,
                    piece_id : piece.id,
                    rotation : rotation == 1,
                    width : width,
                    height : height
                };

                if (space.topleft) {
                    children.push(SplitNode(node, { x : space.left, y : space.top, ...layout }, piece_index));
                }
                if (space.topright && width < space_width) {
                    children.push(SplitNode(node, { x : space.right - width, y : space.top, ...layout }, piece_index));
                }
                if (space.bottomleft && height < space_height) {
                    children.push(SplitNode(node, { x : space.left, y : space.bottom - height, ...layout }, piece_index));
                }
                if (space.bottomright && width < space_width && height < space_height) {
                    children.push(SplitNode(node, { x : space.right - width, y : space.bottom - height, ...layout }, piece_index));
                }
            }
        }
    }

    return children;
}

function EvaluatePlacement(node, options = {}) {
    const placed_count = node.layout.length;
    const used_board_ids = new Set();
    const allow_rotation = Boolean(options.allow_rotation ?? options.allowRotation);

    for (const layout of node.layout) {
        used_board_ids.add(layout.board_id);
    }

    let placeable_piece_count = 0;
    let placeable_piece_area = 0;
    let fit_slack = 0;

    for (const piece of node.unplaced_pieces) {
        let best_slack = Infinity;
        const piece_area = piece.width * piece.height;

        for (const space of node.spaces) {
            const space_width = space.right - space.left;
            const space_height = space.bottom - space.top;
            const space_area = RectArea(space);
            const has_available_corner = space.topleft || space.topright ||
                space.bottomleft || space.bottomright;

            if (!has_available_corner) {
                continue;
            }

            const fits_original = piece.width <= space_width && piece.height <= space_height;

            if (fits_original) {
                best_slack = Math.min(best_slack, space_area - piece_area);
            }

            const fits_rotated = allow_rotation && piece.width != piece.height &&
                piece.height <= space_width && piece.width <= space_height;

            if (fits_rotated) {
                best_slack = Math.min(best_slack, space_area - piece_area);
            }
        }

        if (best_slack != Infinity) {
            placeable_piece_count++;
            placeable_piece_area += piece.width * piece.height;
            fit_slack += best_slack;
        }
    }

    return {
        placed_count : placed_count,
        used_board_count : used_board_ids.size,
        placeable_piece_count : placeable_piece_count,
        placeable_piece_area : placeable_piece_area,
        fit_slack : fit_slack,
        rank : [
            -placed_count,
            -placeable_piece_count,
            -placeable_piece_area,
            used_board_ids.size,
            fit_slack
        ]
    };
}

function CompareEvaluations(a, b) {
    for (let index = 0; index < a.rank.length; index++) {
        if (a.rank[index] < b.rank[index]) return -1;
        if (a.rank[index] > b.rank[index]) return 1;
    }

    return 0;
}

function NodeKey(node) {
    const pieces = node.unplaced_pieces
        .map(piece => `${piece.id}:${piece.width}:${piece.height}`)
        .sort()
        .join('|');
    const layout = node.layout
        .map(item => [
            item.board_id, item.piece_id, item.x, item.y,
            item.width, item.height, Boolean(item.rotation)
        ].join(':'))
        .sort()
        .join('|');
    const spaces = node.spaces
        .map(space => [
            space.id, space.left, space.right, space.top, space.bottom,
            Boolean(space.topleft), Boolean(space.topright),
            Boolean(space.bottomleft), Boolean(space.bottomright)
        ].join(':'))
        .sort()
        .join('|');

    return `${pieces}#${layout}#${spaces}`;
}

function OptimizePlacement2(boards, pieces, options) {
    options = options || {};

    const allow_rotation = Boolean(options.allow_rotation ?? options.allowRotation);
    const kerf = Math.max(0, Number(options.kerf) || 0);
    const edge_margin = Math.max(0, Number(options.edge_margin ?? options.edgeMargin) || 0);
    const beam_search_K = Math.max(1, Math.floor(Number(options.beam_search_K ?? options.beam_width) || 64));
    const board_list = [];
    const initial_spaces = [];

    for (const board of boards) {
        const width = Number(board.width);
        const height = Number(board.height);

        if (!Number.isFinite(width) || !Number.isFinite(height) ||
            width <= edge_margin * 2 || height <= edge_margin * 2) {
            continue;
        }

        const board_copy = { ...board, width : width, height : height };
        board_list.push(board_copy);
        initial_spaces.push({
            id : board.id,
            left : edge_margin,
            right : width - edge_margin,
            top : edge_margin,
            bottom : height - edge_margin,
            topleft : true,
            topright : true,
            bottomleft : true,
            bottomright : true
        });
    }

    if (pieces.length == 0 || initial_spaces.length == 0) {
        return [];
    }

    const initial_node = {
        boards : board_list,
        kerf : kerf,
        unplaced_pieces : pieces.map(piece => ({ ...piece })),
        spaces : initial_spaces,
        layout : []
    };

    let beam = [ initial_node ];
    let best_node = initial_node;
    let best_evaluation = EvaluatePlacement(initial_node, { allow_rotation : allow_rotation });

    for (let depth = 0; depth < pieces.length; depth++) {
        const candidates = [];
        const saved_states = new Set();

        for (const node of beam) {
            const children = ExpandNode(node, { allow_rotation : allow_rotation });

            for (const child of children) {
                const key = NodeKey(child);
                if (saved_states.has(key)) {
                    continue;
                }
                saved_states.add(key);

                const evaluation = EvaluatePlacement(child, { allow_rotation : allow_rotation });
                candidates.push({ node : child, evaluation : evaluation });

                if (CompareEvaluations(evaluation, best_evaluation) < 0) {
                    best_node = child;
                    best_evaluation = evaluation;
                }
            }
        }

        if (candidates.length == 0) {
            break;
        }

        candidates.sort((a, b) => CompareEvaluations(a.evaluation, b.evaluation));
        beam = candidates.slice(0, beam_search_K).map(candidate => candidate.node);

        if (best_node.unplaced_pieces.length == 0) {
            break;
        }
    }

    return best_node.layout;
}
