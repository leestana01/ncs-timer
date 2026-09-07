/* NCS Timer — 문제별 풀이 시간 스톱워치
 * 백엔드 없음. 모든 기록은 localStorage 에만 저장된다.
 */
(function () {
  'use strict';

  var KEY = 'ncs-timer.v1';
  var AWAY_LIMIT = 30000; // 탭을 닫아둔 시간이 이보다 길면 기록에서 제외한다

  var db = { sets: [] };
  var view = { name: 'home', setId: null };
  var lastRendered = null;
  var ticker = null;

  /* ------------------------------------------------------------------ 저장 */

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.sets)) db = parsed;
      }
    } catch (e) {
      console.warn('저장된 기록을 불러오지 못했습니다.', e);
    }
    var s = activeSet();
    if (s && s.segmentStart && s.lastTick) {
      var away = Date.now() - s.lastTick;
      if (away > AWAY_LIMIT) {
        s.segmentStart += away; // 자리를 비운 시간은 풀이 시간으로 세지 않는다
        s.lastTick = Date.now();
        save();
      }
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      console.warn('기록을 저장하지 못했습니다.', e);
    }
  }

  /* ------------------------------------------------------------- 세션 모델 */

  function activeSet() {
    for (var i = 0; i < db.sets.length; i++) {
      if (db.sets[i].status === 'active') return db.sets[i];
    }
    return null;
  }

  function getSet(id) {
    for (var i = 0; i < db.sets.length; i++) {
      if (db.sets[i].id === id) return db.sets[i];
    }
    return null;
  }

  function createSet(name, count) {
    var problems = [];
    for (var i = 0; i < count; i++) problems.push({ attempts: [] });
    var s = {
      id: 'set-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      name: name,
      count: count,
      createdAt: Date.now(),
      finishedAt: null,
      status: 'active',
      phase: 'run',
      currentIndex: 0,
      segmentStart: Date.now(),
      lastTick: Date.now()
    };
    s.problems = problems;
    db.sets.push(s);
    save();
    return s;
  }

  function running(s) {
    return s.status === 'active' && s.currentIndex !== null && s.segmentStart;
  }

  function liveMs(s) {
    return running(s) ? Date.now() - s.segmentStart : 0;
  }

  function attemptsSum(p) {
    var t = 0;
    for (var i = 0; i < p.attempts.length; i++) t += p.attempts[i].ms;
    return t;
  }

  // 문제별 총 시간 (진행 중인 문제는 현재 시간까지 포함)
  function problemMs(s, i) {
    return attemptsSum(s.problems[i]) + (s.currentIndex === i ? liveMs(s) : 0);
  }

  function totalMs(s) {
    var t = 0;
    for (var i = 0; i < s.problems.length; i++) t += problemMs(s, i);
    return t;
  }

  function problemState(s, i) {
    if (s.currentIndex === i) return 'current';
    var a = s.problems[i].attempts;
    if (!a.length) return 'todo';
    var last = a[a.length - 1].result;
    return last === 'solved' ? 'solved' : last === 'passed' ? 'passed' : 'left';
  }

  function closeAttempt(s, result) {
    if (s.currentIndex === null || !s.segmentStart) return;
    var ms = Date.now() - s.segmentStart;
    s.problems[s.currentIndex].attempts.push({ ms: ms, result: result, at: Date.now() });
    s.segmentStart = null;
  }

  function enter(s, index) {
    s.currentIndex = index;
    s.segmentStart = Date.now();
    s.lastTick = Date.now();
  }

  // 다음 / 패스: 첫 순회 중이면 다음 번호로, 검토 단계면 목록으로 돌아간다
  function advance(s, result) {
    if (s.currentIndex === null) return;
    var from = s.currentIndex;
    closeAttempt(s, result);
    if (s.phase === 'run' && from + 1 < s.count) {
      enter(s, from + 1);
    } else {
      s.phase = 'review';
      s.currentIndex = null;
    }
    save();
  }

  function jumpTo(s, index) {
    if (s.currentIndex === index) return;
    closeAttempt(s, 'left');
    enter(s, index);
    save();
  }

  function finishSet(s) {
    closeAttempt(s, 'left');
    s.currentIndex = null;
    s.status = 'finished';
    s.finishedAt = Date.now();
    save();
  }

  /* ---------------------------------------------------------------- 포맷 */

  function fmt(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var mm = h ? pad(m) : String(m);
    return (h ? h + ':' : '') + mm + ':' + pad(s);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() +
      '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function defaultName() {
    var d = new Date();
    return 'NCS ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 세트';
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- 차트 */

  var STEPS = [5, 10, 15, 20, 30, 60, 90, 120, 180, 300, 600, 900, 1800, 3600];

  function niceStep(maxSec) {
    for (var i = 0; i < STEPS.length; i++) {
      if (maxSec / STEPS[i] <= 4) return STEPS[i];
    }
    return STEPS[STEPS.length - 1];
  }

  /* 점 + 선 그래프. values 는 ms 배열. */
  function lineChart(values, labels, opts) {
    opts = opts || {};
    var n = values.length;
    if (!n) return '<p class="empty">그래프로 보여줄 기록이 없습니다.</p>';

    var W = 880, H = 300, L = 58, R = 16, T = 18, B = 36;
    var maxV = Math.max.apply(null, values);
    var step = niceStep(Math.max(maxV / 1000, 1));
    var ticks = Math.max(1, Math.ceil(maxV / 1000 / step));
    var top = ticks * step * 1000;

    var x = function (i) { return n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1); };
    var y = function (v) { return H - B - (v / top) * (H - T - B); };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.aria || '문제별 풀이 시간 그래프') + '">';

    // 가로 격자 + y축 라벨
    for (var k = 0; k <= ticks; k++) {
      var vy = y(k * step * 1000);
      svg += '<line x1="' + L + '" y1="' + vy + '" x2="' + (W - R) + '" y2="' + vy +
        '" stroke="var(--line)" stroke-width="1"/>';
      svg += '<text x="' + (L - 10) + '" y="' + (vy + 4) + '" text-anchor="end" font-size="12" ' +
        'fill="var(--faint)" font-family="ui-monospace, monospace">' + fmt(k * step * 1000) + '</text>';
    }

    // 평균선
    var sum = 0;
    for (var a = 0; a < n; a++) sum += values[a];
    var avg = sum / n;
    var ay = y(avg);
    svg += '<line x1="' + L + '" y1="' + ay + '" x2="' + (W - R) + '" y2="' + ay +
      '" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 5" opacity=".55"/>';
    svg += '<text x="' + (W - R) + '" y="' + (ay - 7) + '" text-anchor="end" font-size="12" ' +
      'fill="var(--accent)">평균 ' + fmt(avg) + '</text>';

    // 선
    var pts = [];
    for (var i = 0; i < n; i++) pts.push(x(i).toFixed(1) + ',' + y(values[i]).toFixed(1));
    svg += '<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" ' +
      'stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/>';

    // 점 + x축 라벨
    var every = Math.ceil(n / 20);
    for (var j = 0; j < n; j++) {
      svg += '<circle cx="' + x(j).toFixed(1) + '" cy="' + y(values[j]).toFixed(1) + '" r="4" ' +
        'fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5">' +
        '<title>' + esc(labels[j]) + ' · ' + fmt(values[j]) + '</title></circle>';
      if (j % every === 0 || j === n - 1) {
        svg += '<text x="' + x(j).toFixed(1) + '" y="' + (H - B + 20) + '" text-anchor="middle" ' +
          'font-size="12" fill="var(--faint)">' + esc(labels[j]) + '</text>';
      }
    }

    svg += '</svg>';
    return svg;
  }

  /* ------------------------------------------------------------- 화면: 홈 */

  function renderHome() {
    var s = activeSet();
    var finished = db.sets.filter(function (x) { return x.status === 'finished'; })
      .sort(function (a, b) { return b.finishedAt - a.finishedAt; });

    var html = '';

    if (s) {
      var doneCount = 0;
      for (var i = 0; i < s.count; i++) if (problemState(s, i) === 'solved') doneCount++;
      html += '<div class="resume">' +
        '<div class="grow"><div style="font-weight:600">진행 중인 세트가 있습니다</div>' +
        '<div class="muted" style="font-size:14px">' + esc(s.name) + ' · ' + doneCount + '/' + s.count +
        ' 문제 완료 · 누적 <span class="mono">' + fmt(totalMs(s)) + '</span></div></div>' +
        '<button class="btn primary" data-action="resume">이어서 풀기</button>' +
        '<button class="btn ghost" data-action="discard">삭제</button>' +
        '</div>';
    }

    html += '<h1>문제당 몇 초가 걸렸을까?</h1>' +
      '<p class="sub">시작을 누르고 문제를 풀며 <b>다음</b>만 누르세요. 나머지는 알아서 기록됩니다.</p>';

    html += '<div class="card">' +
      '<form id="start-form">' +
      '<label class="field"><span>세트 이름</span>' +
      '<input type="text" id="set-name" value="' + esc(defaultName()) + '" maxlength="60" /></label>' +
      '<label class="field"><span>문제 수</span>' +
      '<input type="number" id="set-count" value="20" min="1" max="200" inputmode="numeric" /></label>' +
      '<div class="presets">' +
      [10, 15, 20, 25, 40, 50, 60].map(function (n) {
        return '<button type="button" data-preset="' + n + '">' + n + '문제</button>';
      }).join('') +
      '</div>' +
      '<div style="margin-top:20px"><button class="btn primary lg wide" type="submit">시작하기</button></div>' +
      '</form></div>';

    if (finished.length) {
      html += '<h2>최근 기록</h2><div class="setlist">' +
        finished.slice(0, 4).map(setRow).join('') + '</div>';
      if (finished.length > 4) {
        html += '<div style="margin-top:10px"><button class="linkish" data-nav="sets">전체 기록 보기 →</button></div>';
      }
    }

    return html;
  }

  function setRow(s) {
    var t = totalMs(s);
    var solved = 0;
    for (var i = 0; i < s.count; i++) if (s.problems[i].attempts.length) solved++;
    return '<div class="setrow">' +
      '<div class="grow">' +
      '<div class="name">' + esc(s.name) + '</div>' +
      '<div class="meta">' + fmtDate(s.finishedAt || s.createdAt) + ' · ' + s.count + '문제</div>' +
      '</div>' +
      '<div class="val">' + fmt(t) + '<small>문제당 ' + fmt(solved ? t / solved : 0) + '</small></div>' +
      '<button class="linkish" data-action="open-report" data-id="' + s.id + '">리포트</button>' +
      '</div>';
  }

  /* ------------------------------------------------------- 화면: 풀이 진행 */

  function renderRun() {
    var s = activeSet();
    if (!s) { view.name = 'home'; return renderHome(); }

    var idx = s.currentIndex;
    var open = idx !== null;
    var html = '';

    html += '<div class="run-head">' +
      '<div class="set-name">' + esc(s.name) + '</div>' +
      '<div class="pos">' + (open ? (idx + 1) + ' / ' + s.count + '번' : '검토 단계') + '</div>' +
      '</div>';

    html += '<div class="stage">';
    if (open) {
      var prev = attemptsSum(s.problems[idx]);
      html += '<div class="qlabel">지금 푸는 문제</div>' +
        '<div class="qnum">' + (idx + 1) + '번</div>' +
        '<div class="bigtime" id="big-time">' + fmt(liveMs(s)) + '</div>' +
        '<div class="metaline">' +
        (prev > 0 ? '이 문제 누적 <b id="q-total">' + fmt(prev + liveMs(s)) + '</b> · ' : '') +
        '세트 총 <b id="set-total">' + fmt(totalMs(s)) + '</b></div>';
      html += '<div class="actions">' +
        '<button class="btn" data-action="pass">패스</button>' +
        '<button class="btn primary" data-action="next">' +
        (s.phase === 'run' ? '다음 문제' : '풀이 완료') + '</button>' +
        '</div>' +
        '<div class="row" style="justify-content:center;margin-top:10px">' +
        '<button class="btn ghost" data-action="finish">세트 종료</button></div>' +
        '<div class="hint">스페이스 · → : 다음 &nbsp;|&nbsp; P · ↓ : 패스</div>';
    } else {
      html += '<div class="qlabel">모든 문제를 한 번씩 지나갔습니다</div>' +
        '<div class="bigtime" id="big-time">' + fmt(totalMs(s)) + '</div>' +
        '<div class="metaline">지금까지의 세트 총 시간</div>' +
        '<div class="review-note">아래에서 <b>패스한 문제</b>나 다시 볼 문제를 누르면 그 문제의 시간을 이어서 잽니다. ' +
        '이전 기록은 지워지지 않고 따로 남습니다.</div>' +
        '<div class="actions" style="margin-top:18px">' +
        '<button class="btn primary" data-action="finish">세트 종료하고 리포트 보기</button></div>';
    }
    html += '</div>';

    html += grid(s);
    return html;
  }

  function grid(s) {
    var html = '<div class="grid-head"><h3 style="margin:0">문제 목록</h3>' +
      '<div class="legend">' +
      '<span><i class="l-solved"></i>완료</span>' +
      '<span><i class="l-passed"></i>패스</span>' +
      '<span><i class="l-left"></i>중단</span>' +
      '<span><i class="l-todo"></i>미풀이</span>' +
      '</div></div><div class="grid" id="grid">';
    for (var i = 0; i < s.count; i++) {
      var st = problemState(s, i);
      var ms = problemMs(s, i);
      html += '<button class="chip ' + st + '" data-action="goto" data-index="' + i + '"' +
        (st === 'current' ? ' disabled' : '') + '>' +
        '<div class="n">' + (i + 1) + '</div>' +
        '<div class="t" data-time="' + i + '">' + (ms ? fmt(ms) : '–') + '</div>' +
        '</button>';
    }
    return html + '</div>';
  }

  /* --------------------------------------------------- 화면: 세트 리포트 */

  function renderReport() {
    var s = getSet(view.setId);
    if (!s) { view.name = 'sets'; return renderSets(); }

    var values = [], labels = [], touched = 0, maxI = -1, minI = -1;
    for (var i = 0; i < s.count; i++) {
      var ms = problemMs(s, i);
      values.push(ms);
      labels.push(String(i + 1));
      if (s.problems[i].attempts.length) {
        touched++;
        if (maxI < 0 || ms > values[maxI]) maxI = i;
        if (minI < 0 || ms < values[minI]) minI = i;
      }
    }
    var total = totalMs(s);
    var avg = touched ? total / touched : 0;

    var html = '<div class="row" style="margin:16px 0 4px">' +
      '<button class="linkish" data-nav="sets">← 기록</button></div>';
    html += '<h1>' + esc(s.name) + '</h1>' +
      '<p class="sub">' + fmtDate(s.createdAt) + ' 시작 · ' +
      (s.finishedAt ? fmtDate(s.finishedAt) + ' 종료' : '진행 중') + '</p>';

    html += '<div class="stats">' +
      stat('총 풀이 시간', fmt(total)) +
      stat('문제당 평균', fmt(avg)) +
      stat('푼 문제', touched + ' / ' + s.count) +
      stat('가장 오래 걸린 문제', maxI >= 0 ? (maxI + 1) + '번 · ' + fmt(values[maxI]) : '–') +
      stat('가장 빨리 푼 문제', minI >= 0 ? (minI + 1) + '번 · ' + fmt(values[minI]) : '–') +
      '</div>';

    html += '<h2>문제별 풀이 시간</h2>' +
      '<div class="chart-wrap">' + lineChart(values, labels, { aria: '문제 번호별 총 풀이 시간' }) +
      '<div class="chart-note">가로축 문제 번호, 세로축 총 풀이 시간(재도전 포함). 점에 마우스를 올리면 값이 보입니다.</div></div>';

    html += '<h2>문제별 상세</h2><div class="table-wrap"><table><thead><tr>' +
      '<th>문제</th><th>시도 기록 (1차 → 2차 → …)</th><th class="num">시도</th>' +
      '<th class="num">총계</th><th>상태</th></tr></thead><tbody>';
    for (var j = 0; j < s.count; j++) {
      var p = s.problems[j];
      var st = problemState(s, j);
      var tries = p.attempts.map(function (a, k) {
        return '<span class="try ' + a.result + '">' + (k + 1) + '차 ' + fmt(a.ms) + '</span>';
      }).join('');
      html += '<tr>' +
        '<td>' + (j + 1) + '번</td>' +
        '<td><div class="tries">' + (tries || '<span class="muted">–</span>') + '</div></td>' +
        '<td class="num">' + p.attempts.length + '</td>' +
        '<td class="num">' + (values[j] ? fmt(values[j]) : '–') + '</td>' +
        '<td><span class="tag ' + st + '">' + stateLabel(st) + '</span></td></tr>';
    }
    html += '<tr class="total"><td>합계</td><td></td><td class="num">' +
      s.problems.reduce(function (n, p) { return n + p.attempts.length; }, 0) +
      '</td><td class="num">' + fmt(total) + '</td><td></td></tr>';
    html += '</tbody></table></div>';

    html += '<div class="row" style="margin-top:22px">' +
      '<button class="btn" data-nav="sets">다른 기록 보기</button>' +
      '<button class="btn ghost" data-nav="home">새 세트 시작</button>' +
      '<button class="btn danger" data-action="delete-set" data-id="' + s.id + '">이 세트 삭제</button>' +
      '</div>';

    return html;
  }

  function stateLabel(st) {
    return st === 'solved' ? '완료'
      : st === 'passed' ? '패스'
      : st === 'current' ? '진행 중'
      : st === 'left' ? '중단' : '미풀이';
  }

  function stat(k, v) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }

  /* ------------------------------------------------ 화면: 세트 단위 리포트 */

  function renderSets() {
    var finished = db.sets.filter(function (x) { return x.status === 'finished'; })
      .sort(function (a, b) { return (a.finishedAt || a.createdAt) - (b.finishedAt || b.createdAt); });

    var html = '<h1>기록</h1><p class="sub">지금까지 푼 세트 전체를 한눈에 봅니다.</p>';

    if (!finished.length) {
      html += '<div class="empty">아직 마친 세트가 없습니다.<br><br>' +
        '<button class="btn primary" data-nav="home">첫 세트 시작하기</button></div>';
      var act = activeSet();
      if (act) {
        html += '<h2>진행 중</h2><div class="setlist"><div class="setrow">' +
          '<div class="grow"><div class="name">' + esc(act.name) + '</div>' +
          '<div class="meta">' + fmtDate(act.createdAt) + ' 시작 · ' + act.count + '문제</div></div>' +
          '<div class="val">' + fmt(totalMs(act)) + '</div>' +
          '<button class="linkish" data-action="resume">이어서</button></div></div>';
      }
      return html;
    }

    var totalTime = 0, totalSolved = 0, avgs = [], labels = [];
    finished.forEach(function (s, i) {
      var t = totalMs(s), solved = 0;
      for (var k = 0; k < s.count; k++) if (s.problems[k].attempts.length) solved++;
      totalTime += t;
      totalSolved += solved;
      avgs.push(solved ? t / solved : 0);
      labels.push('#' + (i + 1));
    });

    var best = 0;
    for (var b = 1; b < avgs.length; b++) if (avgs[b] < avgs[best]) best = b;

    html += '<div class="stats">' +
      stat('세트 수', finished.length + '개') +
      stat('푼 문제', totalSolved + '문제') +
      stat('총 학습 시간', fmt(totalTime)) +
      stat('전체 문제당 평균', fmt(totalSolved ? totalTime / totalSolved : 0)) +
      stat('가장 빨랐던 세트', labels[best] + ' · ' + fmt(avgs[best])) +
      '</div>';

    html += '<h2>세트별 문제당 평균 시간</h2>' +
      '<div class="chart-wrap">' + lineChart(avgs, labels, { aria: '세트별 문제당 평균 풀이 시간' }) +
      '<div class="chart-note">오래된 세트부터 순서대로. 선이 내려가면 문제당 속도가 빨라지고 있다는 뜻입니다.</div></div>';

    html += '<h2>세트 목록</h2><div class="setlist">' +
      finished.slice().reverse().map(setRow).join('') + '</div>';

    html += '<div class="row" style="margin-top:22px">' +
      '<button class="btn ghost" data-action="export">기록 내보내기 (JSON)</button></div>';

    return html;
  }

  /* -------------------------------------------------------------- 렌더링 */

  function render() {
    var app = document.getElementById('app');
    var html;
    if (view.name === 'run') html = renderRun();
    else if (view.name === 'report') html = renderReport();
    else if (view.name === 'sets') html = renderSets();
    else html = renderHome();
    var keepScroll = view.name === lastRendered;
    var y = window.scrollY;
    app.innerHTML = html;
    window.scrollTo(0, keepScroll ? y : 0);
    lastRendered = view.name;
    setTicker();
  }

  function setTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    var s = activeSet();
    if (view.name === 'run' && s && running(s)) ticker = setInterval(tick, 250);
  }

  function tick() {
    var s = activeSet();
    if (!s || !running(s)) { setTicker(); return; }
    var live = liveMs(s);
    var big = document.getElementById('big-time');
    if (big) big.textContent = fmt(live);
    var qt = document.getElementById('q-total');
    if (qt) qt.textContent = fmt(attemptsSum(s.problems[s.currentIndex]) + live);
    var st = document.getElementById('set-total');
    if (st) st.textContent = fmt(totalMs(s));
    var cell = document.querySelector('[data-time="' + s.currentIndex + '"]');
    if (cell) cell.textContent = fmt(problemMs(s, s.currentIndex));

    if (Date.now() - (s.lastTick || 0) > 2000) { s.lastTick = Date.now(); save(); }
  }

  function go(name, setId) {
    view = { name: name, setId: setId || null };
    render();
  }

  /* ---------------------------------------------------------------- 동작 */

  function doNext() {
    var s = activeSet();
    if (s && s.currentIndex !== null) { advance(s, 'solved'); render(); }
  }

  function doPass() {
    var s = activeSet();
    if (s && s.currentIndex !== null) { advance(s, 'passed'); render(); }
  }

  function doFinish() {
    var s = activeSet();
    if (!s) return;
    var open = s.currentIndex !== null;
    var msg = open
      ? '세트를 종료할까요? 지금 문제의 시간까지 기록됩니다.'
      : '세트를 종료하고 리포트를 볼까요?';
    if (!confirm(msg)) return;
    finishSet(s);
    go('report', s.id);
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('[data-action],[data-nav],[data-preset]');
    if (!el) return;

    var preset = el.getAttribute('data-preset');
    if (preset) {
      var input = document.getElementById('set-count');
      if (input) input.value = preset;
      return;
    }

    var nav = el.getAttribute('data-nav');
    if (nav) { go(nav); return; }

    var action = el.getAttribute('data-action');
    var s;
    switch (action) {
      case 'resume':
        go('run');
        break;
      case 'discard':
        s = activeSet();
        if (s && confirm('진행 중인 세트를 삭제할까요? 기록이 사라집니다.')) {
          db.sets = db.sets.filter(function (x) { return x.id !== s.id; });
          save();
          render();
        }
        break;
      case 'next': doNext(); break;
      case 'pass': doPass(); break;
      case 'finish': doFinish(); break;
      case 'goto':
        s = activeSet();
        if (s) { jumpTo(s, parseInt(el.getAttribute('data-index'), 10)); render(); }
        break;
      case 'open-report':
        go('report', el.getAttribute('data-id'));
        break;
      case 'delete-set':
        if (confirm('이 세트의 기록을 삭제할까요? 되돌릴 수 없습니다.')) {
          var id = el.getAttribute('data-id');
          db.sets = db.sets.filter(function (x) { return x.id !== id; });
          save();
          go('sets');
        }
        break;
      case 'export':
        exportJson();
        break;
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'start-form') return;
    e.preventDefault();
    if (activeSet()) {
      if (!confirm('진행 중인 세트가 있습니다. 새로 시작하면 진행 중인 세트는 종료됩니다. 계속할까요?')) return;
      finishSet(activeSet());
    }
    var name = (document.getElementById('set-name').value || '').trim() || defaultName();
    var count = parseInt(document.getElementById('set-count').value, 10);
    if (!count || count < 1) count = 1;
    if (count > 200) count = 200;
    createSet(name, count);
    go('run');
  });

  document.addEventListener('keydown', function (e) {
    if (view.name !== 'run') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      doNext();
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'ㅔ' || e.key === 'ArrowDown') {
      e.preventDefault();
      doPass();
    }
  });

  document.addEventListener('visibilitychange', function () {
    var s = activeSet();
    if (s) { s.lastTick = Date.now(); save(); }
  });

  function exportJson() {
    var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ncs-timer-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------------------------------------------------------- 시작 */

  load();
  var pending = activeSet();
  view.name = pending ? 'run' : 'home';
  render();
})();
