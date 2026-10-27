
function findInitialLayout(boards, pieces, options){

    let allow_rotation = options.allow_rotation;

    // best fit 알고리즘


    // pieces 넓이 내림차순으로 정렬
    pieces.sort((a, b) => b.width * b.height - a.width * a.height)

    spaces = new Array()

    for (let board in boards){
        spaces.push(board)
    }


}


function OptimizePlacement(boards, pieces, options) {
    return findInitialLayout(boards, pieces, options)
}