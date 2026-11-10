// bin-packing-optimizer.js
//
// 직사각형 재단 배치 최적화 : OptimizePlacement3(boards, pieces, options)
// 입력 / 출력 형식은 OptimizePlacement(compute.js), OptimizePlacement2(bin-packing-search.js)와 같습니다.
//
// 구성
//   1) 디코더      : MaxRects(최대 빈 사각형) 배치기. "조각 순서 + 몇 가지 선택 규칙"을 받아 배치 1개를 만든다.
//                    노드를 복사하지 않고 빈 공간 목록 하나만 갱신하므로 한 번 디코딩하는 데 아주 짧게 걸린다.
//   2) 다중 시작   : 정렬 기준 x 배치 규칙 조합으로 해를 여러 개 만들고 가장 좋은 것을 고른다.
//   3) 반복 지역 탐색(ILS) : 가장 좋은 해의 조각 순서를 조금씩 바꿔 다시 디코딩하며 개선한다.
//                    판재를 더 적게 쓰는 방향, 마지막 판재를 최대한 비우는 방향으로 탐색한다.
//
// 톱날 두께(kerf) 처리 : 모든 조각과 판재를 kerf만큼 키워서 배치하면 조각 사이 간격이 정확히 kerf가 되고
//                        판재 가장자리에는 여분이 생기지 않는다. (조각 w -> w+kerf, 판재 W -> W+kerf)
//
// 목표(우선순위 순) : 1) 배치된 넓이 최대  2) 사용 판재 넓이 최소  3) 판재별 채움을 한쪽으로 몰아 남는 판재를 크게
//
// options : allow_rotation, kerf, edge_margin   (기존과 동일)
//           time_limit_ms   탐색 시간 상한(기본 350)
//           max_iterations  탐색 반복 횟수 상한(기본 제한 없음)
//           seed            난수 시드(기본: 입력으로부터 계산, 같은 입력이면 같은 시드)

var OptimizePlacement3 = (function () {
    'use strict';

    const EPS = 1e-7;
    const HEURISTIC_COUNT = 5;   // 0 BSSF, 1 BLSF, 2 BAF, 3 위-왼쪽 우선, 4 접촉점(Contact Point)

    function nowMs() {
        return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    }

    function createRng(seed) {
        let state = seed >>> 0;
        return function () {
            state = (state + 0x6D2B79F5) >>> 0;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ------------------------------------------------------------------ 문제 구성

    function fitsEmptyBin(item, bin) {
        return (item.pw <= bin.w + EPS && item.ph <= bin.h + EPS) ||
            (item.rotatable && item.ph <= bin.w + EPS && item.pw <= bin.h + EPS);
    }

    function buildProblem(boards, pieces, options) {
        const allowRotation = Boolean(options.allow_rotation ?? options.allowRotation);
        const kerf = Math.max(0, Number(options.kerf) || 0);
        const margin = Math.max(0, Number(options.edge_margin ?? options.edgeMargin) || 0);

        const bins = [];
        for (const board of boards) {
            const width = Number(board.width);
            const height = Number(board.height);

            if (!Number.isFinite(width) || !Number.isFinite(height) ||
                width <= margin * 2 || height <= margin * 2) {
                continue;
            }

            bins.push({
                id: board.id,
                offset: margin,
                w: width - margin * 2 + kerf,
                h: height - margin * 2 + kerf,
                area: width * height
            });
        }

        // 어떤 판재에도 들어가지 않는 조각은 처음부터 제외한다. (결과에 나타나지 않으므로 "실패"로 집계된다)
        const items = [];
        for (const piece of pieces) {
            const w = Number(piece.width);
            const h = Number(piece.height);

            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
                continue;
            }

            const item = {
                id: piece.id,
                w: w,
                h: h,
                pw: w + kerf,
                ph: h + kerf,
                area: w * h,
                rotatable: allowRotation && w !== h
            };

            if (bins.some(bin => fitsEmptyBin(item, bin))) {
                items.push(item);
            }
        }

        return { bins: bins, items: items, kerf: kerf, margin: margin, allowRotation: allowRotation };
    }

    // ------------------------------------------------------------------ 해(genome)

    // order     : 조각을 배치하는 순서
    // mask      : 조각별 방향 선호. 1 = 원래 방향만, 2 = 회전만, 3 = 둘 다 (선호대로 안 되면 3으로 다시 시도)
    // heuristic : 빈 공간 선택 규칙
    // binMode   : 0 = 열린 판재 전체에서 최선, 1 = 먼저 열린 판재부터 (first fit)
    // policy    : 새 판재를 열 때 0 = 가장 작은 판재, 1 = 입력 순서, 2 = 가장 큰 판재
    function createGenome(n) {
        return {
            order: new Int32Array(n),
            mask: new Uint8Array(n).fill(3),
            heuristic: 0,
            binMode: 0,
            policy: 0
        };
    }

    function copyGenome(target, source) {
        target.order.set(source.order);
        target.mask.set(source.mask);
        target.heuristic = source.heuristic;
        target.binMode = source.binMode;
        target.policy = source.policy;
    }

    // 결과 비교 : 배치 넓이 큰 쪽 -> 사용 판재 넓이 작은 쪽 -> 채움을 몰아준 쪽
    function isBetter(a, b) {
        if (a.placed !== b.placed) return a.placed > b.placed;
        if (a.used !== b.used) return a.used < b.used;
        return a.conc > b.conc;
    }

    // ------------------------------------------------------------------ MaxRects 디코더

    function createDecoder(problem) {
        const items = problem.items;
        const bins = problem.bins;
        const n = items.length;
        const m = bins.length;

        const PW = new Float64Array(n);
        const PH = new Float64Array(n);
        const AREA = new Float64Array(n);
        const CAN_ROTATE = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            PW[i] = items[i].pw;
            PH[i] = items[i].ph;
            AREA[i] = items[i].area;
            CAN_ROTATE[i] = items[i].rotatable ? 1 : 0;
        }

        const BW = new Float64Array(m);
        const BH = new Float64Array(m);
        const BAREA = new Float64Array(m);
        for (let b = 0; b < m; b++) {
            BW[b] = bins[b].w;
            BH[b] = bins[b].h;
            BAREA[b] = bins[b].area;
        }

        // 어떤 조각도 들어가지 못할 만큼 작은 빈 공간은 버린다.
        let minW = Infinity;
        let minH = Infinity;
        for (let i = 0; i < n; i++) {
            const shortSide = Math.min(PW[i], PH[i]);
            minW = Math.min(minW, CAN_ROTATE[i] ? shortSide : PW[i]);
            minH = Math.min(minH, CAN_ROTATE[i] ? shortSide : PH[i]);
        }

        const free = [];                       // free[b] = [left, top, right, bottom, ...]
        for (let b = 0; b < m; b++) free.push([]);
        const placedRects = [];                // placedRects[b] = [left, top, right, bottom, ...] (접촉점 규칙용)
        for (let b = 0; b < m; b++) placedRects.push([]);
        const opened = new Int32Array(m);      // 열린 순서대로 판재 번호
        const isOpen = new Uint8Array(m);
        let openCount = 0;

        const px = new Float64Array(n);
        const py = new Float64Array(n);
        const pbin = new Int32Array(n);
        const prot = new Uint8Array(n);
        const fill = new Float64Array(m);
        const scratch = [];

        // 가장 좋은 후보
        let cBin = -1, cX = 0, cY = 0, cRot = 0, cS1 = Infinity, cS2 = Infinity;

        // 사각형 (x, y, w, h)가 판재 가장자리와 이미 놓인 조각에 닿는 둘레 길이
        function contactLength(b, x, y, w, h) {
            const r = x + w;
            const bt = y + h;
            let c = 0;

            if (x <= EPS) c += h;
            if (y <= EPS) c += w;
            if (r >= BW[b] - EPS) c += h;
            if (bt >= BH[b] - EPS) c += w;

            const p = placedRects[b];
            for (let k = 0; k < p.length; k += 4) {
                const pl = p[k], pt = p[k + 1], pr = p[k + 2], pb = p[k + 3];

                if (Math.abs(pr - x) <= EPS || Math.abs(pl - r) <= EPS) {
                    const overlap = (bt < pb ? bt : pb) - (y > pt ? y : pt);
                    if (overlap > 0) c += overlap;
                }
                if (Math.abs(pb - y) <= EPS || Math.abs(pt - bt) <= EPS) {
                    const overlap = (r < pr ? r : pr) - (x > pl ? x : pl);
                    if (overlap > 0) c += overlap;
                }
            }

            return c;
        }

        function consider(b, fx, fy, fw, fh, w, h, rot, heuristic) {
            const lw = fw - w;
            const lh = fh - h;
            let s1, s2;

            switch (heuristic) {
                case 0:  // Best Short Side Fit
                    s1 = lw < lh ? lw : lh;
                    s2 = lw < lh ? lh : lw;
                    break;
                case 1:  // Best Long Side Fit
                    s1 = lw < lh ? lh : lw;
                    s2 = lw < lh ? lw : lh;
                    break;
                case 2:  // Best Area Fit
                    s1 = fw * fh - w * h;
                    s2 = lw < lh ? lw : lh;
                    break;
                case 3:  // 위쪽 -> 왼쪽 우선
                    s1 = fy + h;
                    s2 = fx;
                    break;
                default: // Contact Point : 닿는 길이가 가장 긴 자리
                    s1 = -contactLength(b, fx, fy, w, h);
                    s2 = fy + h;
                    break;
            }

            if (s1 < cS1 - EPS || (s1 <= cS1 + EPS && s2 < cS2 - EPS)) {
                cBin = b; cX = fx; cY = fy; cRot = rot; cS1 = s1; cS2 = s2;
            }
        }

        function scanBin(b, i, mask, heuristic) {
            const f = free[b];
            const w0 = PW[i];
            const h0 = PH[i];
            const originalOk = (mask & 1) !== 0;
            const rotatedOk = (mask & 2) !== 0 && CAN_ROTATE[i] === 1;

            for (let j = 0; j < f.length; j += 4) {
                const fx = f[j];
                const fy = f[j + 1];
                const fw = f[j + 2] - fx;
                const fh = f[j + 3] - fy;

                if (originalOk && w0 <= fw + EPS && h0 <= fh + EPS) {
                    consider(b, fx, fy, fw, fh, w0, h0, 0, heuristic);
                }
                if (rotatedOk && h0 <= fw + EPS && w0 <= fh + EPS) {
                    consider(b, fx, fy, fw, fh, h0, w0, 1, heuristic);
                }
            }
        }

        function fitsBin(i, b, mask) {
            const originalOk = (mask & 1) !== 0;
            const rotatedOk = (mask & 2) !== 0 && CAN_ROTATE[i] === 1;
            return (originalOk && PW[i] <= BW[b] + EPS && PH[i] <= BH[b] + EPS) ||
                (rotatedOk && PH[i] <= BW[b] + EPS && PW[i] <= BH[b] + EPS);
        }

        function openBin(i, mask, policy) {
            let pick = -1;

            for (let b = 0; b < m; b++) {
                if (isOpen[b] || !fitsBin(i, b, mask)) continue;

                if (pick < 0) {
                    pick = b;
                    if (policy === 1) break;
                    continue;
                }

                if (policy === 0 ? BAREA[b] < BAREA[pick] : BAREA[b] > BAREA[pick]) {
                    pick = b;
                }
            }

            if (pick < 0) return -1;

            isOpen[pick] = 1;
            opened[openCount++] = pick;
            free[pick].length = 0;
            free[pick].push(0, 0, BW[pick], BH[pick]);
            placedRects[pick].length = 0;
            return pick;
        }

        // 배치한 사각형 (x, y, r, bt)과 겹치는 빈 공간을 쪼개고, 다른 공간에 완전히 포함되는 조각은 버린다.
        function split(b, x, y, r, bt) {
            const f = free[b];
            const s = scratch;
            s.length = 0;
            let len = f.length;

            for (let j = 0; j < len;) {
                const fx = f[j], fy = f[j + 1], fr = f[j + 2], fb = f[j + 3];

                if (x >= fr - EPS || r <= fx + EPS || y >= fb - EPS || bt <= fy + EPS) {
                    j += 4;
                    continue;
                }

                if (x > fx + EPS) s.push(fx, fy, x, fb);
                if (r < fr - EPS) s.push(r, fy, fr, fb);
                if (y > fy + EPS) s.push(fx, fy, fr, y);
                if (bt < fb - EPS) s.push(fx, bt, fr, fb);

                len -= 4;
                f[j] = f[len];
                f[j + 1] = f[len + 1];
                f[j + 2] = f[len + 2];
                f[j + 3] = f[len + 3];
            }

            f.length = len;
            const sl = s.length;

            // 건드리지 않은 기존 공간은 새 조각에 포함될 수 없으므로 "새 조각 -> 기존/새 조각" 방향만 검사한다.
            outer:
            for (let a = 0; a < sl; a += 4) {
                const ax = s[a], ay = s[a + 1], ar = s[a + 2], ab = s[a + 3];

                if (ar - ax < minW - EPS || ab - ay < minH - EPS) continue;

                for (let k = 0; k < len; k += 4) {
                    if (f[k] <= ax + EPS && f[k + 1] <= ay + EPS && f[k + 2] >= ar - EPS && f[k + 3] >= ab - EPS) {
                        continue outer;
                    }
                }

                for (let c = 0; c < sl; c += 4) {
                    if (c === a) continue;

                    if (s[c] <= ax + EPS && s[c + 1] <= ay + EPS && s[c + 2] >= ar - EPS && s[c + 3] >= ab - EPS) {
                        const same = ax <= s[c] + EPS && ay <= s[c + 1] + EPS && ar >= s[c + 2] - EPS && ab >= s[c + 3] - EPS;
                        if (!same || c < a) continue outer;
                    }
                }

                f.push(ax, ay, ar, ab);
            }
        }

        function place(i, mask, heuristic, binMode, policy) {
            cBin = -1;
            cS1 = Infinity;
            cS2 = Infinity;

            if (binMode === 2) {
                // 아직 열지 않은 판재도 "빈 판재 1장"으로 후보에 넣고, 가장 잘 맞는 자리를 고른다. (크기가 다른 판재가 섞인 경우용)
                for (let b = 0; b < m; b++) {
                    scanBin(b, i, mask, heuristic);
                }

                if (cBin < 0) return false;

                if (!isOpen[cBin]) {
                    isOpen[cBin] = 1;
                    opened[openCount++] = cBin;
                }
            } else {
                for (let oi = 0; oi < openCount; oi++) {
                    scanBin(opened[oi], i, mask, heuristic);
                    if (binMode === 1 && cBin >= 0) break;
                }
            }

            if (cBin < 0) {
                const b = openBin(i, mask, policy);
                if (b < 0) return false;

                scanBin(b, i, mask, heuristic);
                if (cBin < 0) return false;
            }

            const w = cRot ? PH[i] : PW[i];
            const h = cRot ? PW[i] : PH[i];

            px[i] = cX;
            py[i] = cY;
            pbin[i] = cBin;
            prot[i] = cRot;
            placedRects[cBin].push(cX, cY, cX + w, cY + h);
            split(cBin, cX, cY, cX + w, cY + h);
            return true;
        }

        function evaluate() {
            let placed = 0;
            let count = 0;
            fill.fill(0);

            // 조각 번호 순으로 더해서 같은 조각 집합이면 항상 같은 값이 나오게 한다.
            for (let i = 0; i < n; i++) {
                if (pbin[i] >= 0) {
                    placed += AREA[i];
                    fill[pbin[i]] += AREA[i];
                    count++;
                }
            }

            let used = 0;
            let conc = 0;
            for (let b = 0; b < m; b++) {
                if (isOpen[b]) {
                    used += BAREA[b];
                    conc += fill[b] * fill[b];
                }
            }

            return { placed: placed, count: count, used: used, conc: conc, bins: openCount };
        }

        function decode(genome) {
            const fresh = genome.binMode === 2;

            for (let b = 0; b < m; b++) {
                free[b].length = 0;
                placedRects[b].length = 0;
                isOpen[b] = 0;
                if (fresh) free[b].push(0, 0, BW[b], BH[b]);
            }
            openCount = 0;
            pbin.fill(-1);

            const order = genome.order;
            const masks = genome.mask;

            for (let k = 0; k < n; k++) {
                const i = order[k];
                const mask = masks[i];

                if (!place(i, mask, genome.heuristic, genome.binMode, genome.policy) && mask !== 3) {
                    place(i, 3, genome.heuristic, genome.binMode, genome.policy);
                }
            }

            return evaluate();
        }

        function collect() {
            const result = [];

            for (let i = 0; i < n; i++) {
                const b = pbin[i];
                if (b < 0) continue;

                const rotated = prot[i] === 1;
                result.push({
                    board_id: bins[b].id,
                    piece_id: items[i].id,
                    x: bins[b].offset + px[i],
                    y: bins[b].offset + py[i],
                    width: rotated ? items[i].h : items[i].w,
                    height: rotated ? items[i].w : items[i].h,
                    rotation: rotated,
                    _bin: b
                });
            }

            result.sort((p, q) => p._bin - q._bin || p.y - q.y || p.x - q.x);
            for (const placement of result) delete placement._bin;
            return result;
        }

        return {
            decode: decode,
            collect: collect,
            pbin: pbin,
            lastBin: () => openCount > 0 ? opened[openCount - 1] : -1
        };
    }

    // ------------------------------------------------------------------ 시작 순서

    function createSortedOrders(problem) {
        const items = problem.items;
        const n = items.length;

        const keys = [
            item => item.pw * item.ph,
            item => Math.max(item.pw, item.ph),
            item => Math.min(item.pw, item.ph),
            item => item.pw + item.ph
        ];

        if (!problem.allowRotation) {
            keys.push(item => item.ph, item => item.pw);
        }

        return keys.map(key => {
            const index = Array.from({ length: n }, (_, i) => i);
            index.sort((a, b) =>
                key(items[b]) - key(items[a]) ||
                items[b].pw * items[b].ph - items[a].pw * items[a].ph ||
                a - b);
            return Int32Array.from(index);
        });
    }

    // ------------------------------------------------------------------ 최적화

    function optimize(boards, pieces, options) {
        options = options || {};

        const startedAt = nowMs();
        const timeLimit = Math.max(0, Number(options.time_limit_ms ?? options.timeLimitMs ?? 350));
        const maxIterations = Number.isFinite(Number(options.max_iterations)) ? Number(options.max_iterations) : Infinity;
        const problem = buildProblem(boards || [], pieces || [], options);
        const items = problem.items;
        const bins = problem.bins;
        const n = items.length;
        const m = bins.length;

        optimize.lastStats = { pieces: n, boards: m, decodes: 0, iterations: 0, elapsed_ms: 0, stopped: 'empty' };

        if (n === 0 || m === 0) {
            return [];
        }

        let seed = 0x9E3779B9;
        for (const item of items) {
            seed = Math.imul(seed ^ Math.round(item.w * 100) ^ (Math.round(item.h * 100) << 7), 0x01000193) >>> 0;
        }
        const rng = createRng(options.seed !== undefined ? Number(options.seed) : seed);

        const decoder = createDecoder(problem);
        const hetero = bins.some(bin => bin.w !== bins[0].w || bin.h !== bins[0].h);
        const hasRotation = items.some(item => item.rotatable);
        let decodes = 0;

        // 사용할 판재 수의 하한 : 조각 넓이 합을 담으려면 최소 몇 장이 필요한가
        let needArea = 0;
        for (const item of items) needArea += item.pw * item.ph;
        const binAreas = bins.map(bin => bin.w * bin.h).sort((a, b) => b - a);
        let lowerBound = 0;
        for (let acc = 0, k = 0; k < binAreas.length; k++) {
            acc += binAreas[k];
            lowerBound = k + 1;
            if (acc + EPS >= needArea) break;
        }

        // ---- 1단계 : 다중 시작
        const best = createGenome(n);
        const trial = createGenome(n);
        let bestResult = null;

        const orders = createSortedOrders(problem);
        const binModes = hetero ? [0, 1, 2] : m > 1 ? [0, 1] : [0];
        const policies = hetero ? [0, 1, 2] : [0];
        let stopped = 'stagnation';

        construct:
        for (const order of orders) {
            for (let heuristic = 0; heuristic < HEURISTIC_COUNT; heuristic++) {
                for (const binMode of binModes) {
                    for (const policy of policies) {
                        trial.order.set(order);
                        trial.mask.fill(3);
                        trial.heuristic = heuristic;
                        trial.binMode = binMode;
                        trial.policy = policy;

                        const result = decoder.decode(trial);
                        decodes++;

                        if (!bestResult || isBetter(result, bestResult)) {
                            copyGenome(best, trial);
                            bestResult = result;
                        }

                        if (nowMs() - startedAt > timeLimit) {
                            stopped = 'time';
                            break construct;
                        }
                    }
                }
            }
        }

        // ---- 2단계 : 반복 지역 탐색
        let polishLeft = Infinity;
        let done = false;

        function checkLowerBound() {
            if (bestResult.count === n && bestResult.bins <= lowerBound) {
                if (bestResult.bins <= 1) {
                    done = true;                       // 한 장에 다 들어갔다 : 더 줄일 것이 없다
                } else {
                    polishLeft = Math.min(polishLeft, 60 * n + 300);   // 마지막 판재를 비우는 마무리만 짧게
                }
            }
        }

        checkLowerBound();

        let current = createGenome(n);
        let candidate = createGenome(n);
        copyGenome(current, best);
        let currentResult = decoder.decode(current);
        decodes++;

        const currentBin = new Int32Array(n);
        currentBin.set(decoder.pbin);
        let currentLast = decoder.lastBin();

        function pickIndex(count) {
            return (rng() * count) | 0;
        }

        function moveItem(order, from, to) {
            const value = order[from];
            if (from < to) {
                for (let k = from; k < to; k++) order[k] = order[k + 1];
            } else {
                for (let k = from; k > to; k--) order[k] = order[k - 1];
            }
            order[to] = value;
        }

        function mutate(genome) {
            const order = genome.order;
            const r = rng();

            if (n >= 2 && r < 0.30) {                      // 두 조각 위치 교환
                const a = pickIndex(n);
                let b = pickIndex(n);
                if (a === b) b = (b + 1) % n;
                const t = order[a]; order[a] = order[b]; order[b] = t;
                return;
            }

            if (n >= 2 && r < 0.55) {                      // 한 조각을 다른 위치로 옮기기
                const from = pickIndex(n);
                let to = pickIndex(n);
                if (from === to) to = (to + 1) % n;
                moveItem(order, from, to);
                return;
            }

            if (n >= 2 && r < 0.80) {                      // 문제 조각(미배치 / 마지막 판재)을 앞쪽으로
                let pick = -1;
                for (let attempt = 0; attempt < 12; attempt++) {
                    const i = pickIndex(n);
                    if (currentBin[i] < 0 || currentBin[i] === currentLast) {
                        pick = i;
                        break;
                    }
                }

                let position = -1;
                if (pick >= 0) {
                    for (let k = 0; k < n; k++) {
                        if (order[k] === pick) { position = k; break; }
                    }
                }

                if (position > 0) {
                    moveItem(order, position, pickIndex(position));
                } else {
                    const a = pickIndex(n);
                    const b = (a + 1 + pickIndex(n - 1)) % n;
                    const t = order[a]; order[a] = order[b]; order[b] = t;
                }
                return;
            }

            if (n >= 3 && r < 0.88) {                      // 짧은 구간 뒤집기
                const length = 2 + pickIndex(Math.min(n, 8) - 1);
                const start = pickIndex(n - length + 1);
                for (let lo = start, hi = start + length - 1; lo < hi; lo++, hi--) {
                    const t = order[lo]; order[lo] = order[hi]; order[hi] = t;
                }
                return;
            }

            if (hasRotation && r < 0.94) {                 // 조각 방향 선호 바꾸기
                const i = pickIndex(n);
                if (items[i].rotatable) {
                    genome.mask[i] = 1 + pickIndex(3);
                    return;
                }
            }

            const which = pickIndex(3);                    // 선택 규칙 바꾸기
            if (which === 0) {
                genome.heuristic = pickIndex(HEURISTIC_COUNT);
            } else if (which === 1 && m > 1) {
                genome.binMode = pickIndex(hetero ? 3 : 2);
            } else if (hetero) {
                genome.policy = pickIndex(3);
            } else {
                genome.heuristic = pickIndex(HEURISTIC_COUNT);
            }
        }

        let iterations = 0;
        let sinceBest = 0;
        let sinceKick = 0;
        const kickAfter = Math.max(150, n * 4);
        const stagnationLimit = Number.isFinite(Number(options.stagnation)) ? Number(options.stagnation) : Math.max(2500, n * 120);

        while (!done) {
            if (iterations >= maxIterations) { stopped = 'iterations'; break; }
            if (nowMs() - startedAt > timeLimit) { stopped = 'time'; break; }
            if (sinceBest > stagnationLimit) { stopped = 'stagnation'; break; }
            if (polishLeft <= 0) { stopped = 'lower-bound'; break; }

            iterations++;
            sinceBest++;
            sinceKick++;
            polishLeft--;

            copyGenome(candidate, current);
            mutate(candidate);
            const result = decoder.decode(candidate);
            decodes++;

            if (!isBetter(currentResult, result)) {        // 같거나 더 좋으면 받아들인다 (평평한 구간도 이동)
                const t = current; current = candidate; candidate = t;
                currentResult = result;
                currentBin.set(decoder.pbin);
                currentLast = decoder.lastBin();

                if (isBetter(result, bestResult)) {
                    copyGenome(best, current);
                    bestResult = result;
                    sinceBest = 0;
                    checkLowerBound();
                }
            }

            if (sinceKick > kickAfter) {                   // 오래 정체되면 최고 해에서 크게 흔들어 다시 시작
                copyGenome(current, best);
                const kicks = 2 + pickIndex(4);
                for (let k = 0; k < kicks; k++) mutate(current);
                currentResult = decoder.decode(current);
                decodes++;
                currentBin.set(decoder.pbin);
                currentLast = decoder.lastBin();
                sinceKick = 0;
            }
        }

        if (done) stopped = 'lower-bound';

        decoder.decode(best);
        const layout = decoder.collect();

        optimize.lastStats = {
            pieces: n,
            boards: m,
            decodes: decodes,
            iterations: iterations,
            elapsed_ms: nowMs() - startedAt,
            stopped: stopped,
            lower_bound_boards: lowerBound
        };

        return layout;
    }

    optimize.lastStats = null;
    return optimize;
})();