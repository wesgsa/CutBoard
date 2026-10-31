
// corner : topleft, topright, bottomleft, bottomright

function RectIntersect(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function RectArea(a) {
    return (a.right - a.left) * (a.bottom - a.top);
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
        { name : 'topleft', same_position : container.left == candidate.left && container.top == candidate.top },
        { name : 'topright', same_position : container.right == candidate.right && container.top == candidate.top },
        { name : 'bottomleft', same_position : container.left == candidate.left && container.bottom == candidate.bottom },
        { name : 'bottomright', same_position : container.right == candidate.right && container.bottom == candidate.bottom }
    ];

    for (const corner of corners) {
        if (candidate[corner.name] &&
            (!corner.same_position || !container[corner.name])) {
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

function SizeToRect(a) {
    return { left : a.x, right : a.x + a.width, top : a.y, bottom : a.y + a.height };
}

function SplitNode(node, layout) {
    
    let new_pieces = [];
    let new_spaces = [];
    const piece_rect = SizeToRect(layout);

    let piece_was_removed = false;

    for (const piece of node.unplaced_pieces) {
        if (!piece_was_removed && piece.id == layout.piece_id) {
            piece_was_removed = true;
            continue;
        }

        new_pieces.push({ ...piece });
    }

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
        layout : [ ...(node.layout || []), { ...layout } ]
    };

    return next_node;
}

function ExpandNode(node, options) {

    // 확장할 필요 없음
    if (node.unplaced_pieces.length == 0) {
        return [];
    }

    let childs = [];

    const piece = node.unplaced_pieces[0];

    for (let space of node.spaces) {

        const width = space.right - space.left;
        const height = space.bottom - space.top;

        if (piece.width <= width && piece.height <= height) {

            if (space.topleft) { // top-left
                const layout = {
                    x : space.left, y : space.top,
                    board_id : space.id, piece_id : piece.id,
                    rotation : false, width : piece.width, height : piece.height,
                };

                SplitNode(node, layout);
            }

        }

    }

    return childs;
}

function OptimizePlacement2(boards, pieces, options) {
    
    const allow_rotation = options.allow_rotation;
    const kerf           = Math.max(0, options.kerf);
    const edge_margin    = Math.max(0, options.edgeMargin);
    const beam_search_K  = 20;
    


    return [];
}
