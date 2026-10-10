const WORKER_URL = 'https://proxy-gary0417.gary9911.workers.dev/?url=';
const DB_URL = 'https://proxy-gary0417.gary9911.workers.dev/';
const SECRET_KEY = 'MySuperSecretWealth2026';

const $ = id => document.getElementById(id);

// 🌟 四桶投資框架定義表 (對齊操作手冊)
const FOUR_BUCKETS = {
    core: {
        id: 'core',
        name: 'Core Beta',
        subtitle: '長期複利區塊',
        targetMin: 40,
        targetMax: 45,
        targetMid: 42,
        color: '#2C3E50',
        symbols: {
            'VTI': { sub: '美股大盤', market: 'US' },
            '006208': { sub: '台股大盤', market: 'TW' },
            '00878': { sub: '台股緩衝 satellite', market: 'TW' },
            '2886': { sub: '台股緩衝 satellite', market: 'TW' }
        }
    },
    growth: {
        id: 'growth',
        name: 'Growth Beta',
        subtitle: '追加長期獲利',
        targetMin: 20,
        targetMax: 25,
        targetMid: 23,
        hardMax: 30,
        color: '#5B8DB8',
        symbols: {
            'QQQ': { sub: '美股科技巨頭', market: 'US' },
            'SMH': { sub: '美股半導體', market: 'US' },
            '00881': { sub: '台股科技板塊', market: 'TW' },
            '2330': { sub: '半導體龍頭', market: 'TW' }
        }
    },
    alpha: {
        id: 'alpha',
        name: 'Alpha',
        subtitle: '主動超額報酬',
        targetMin: 10,
        targetMax: 15,
        targetMid: 12,
        hardMax: 15,
        color: '#D96B6B',
        symbols: {
            'GOOG': { sub: '美國科技巨頭', market: 'US' },
            '2881': { sub: '台灣金融股龍頭', market: 'TW' },
            '00947': { sub: '台灣IC設計', market: 'TW' }
        }
    },
    cash: {
        id: 'cash',
        name: '現金／債',
        subtitle: '防守 + 等待機會',
        targetMin: 20,
        targetMax: 25,
        targetMid: 23,
        hardMin: 15,
        color: '#C5A059',
        symbols: {
            'SGOV': { sub: '可動用現金', market: 'US' },
            'LQD': { sub: '防禦型債券', market: 'US' }
        }
    }
};

const appData = {
    cash: 0,
    settings: { usdToTwd: 31.5 },
    twStocks: [],
    usStocks: [],
    history: [],
    netWorthHistory: [],
    transactions: [],
    valuations: {},
    totals: { grandNet: 0, grandCost: 0, stockNet: 0, stockCost: 0, twNet: 0, usNet: 0, todayProfit: 0 },
    marketTime: { tw: null, us: null },
    benchmarkData: null
};

let twseDataMap = null;
let isHistoryLoaded = false;
let isDataInitialized = false;
let currentHeroMode = 'default';
let currentTab = 'dashboard';
let chartInst = { allocation: null, nw: null, stock: null, cash: null };
const changelog = [];

const fmtM = n => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtMax2 = n => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtMax3 = n => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const fmtP = n => (n > 0 ? '+' : '') + (n || 0).toFixed(2) + '%';
const clr = n => n > 0 ? 'color-up' : (n < 0 ? 'color-down' : '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const showToast = msg => {
    const t = $('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
};

const fmtTime = ms => {
    if (!ms) return "依最新收盤價";
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 🌟 甜甜圈圖直接繪製整數百分比 Plugin
const doughnutPercentagePlugin = {
    id: 'doughnutPercentagePlugin',
    afterDraw(chart) {
        if (chart.config.type !== 'doughnut') return;
        const { ctx } = chart;
        const dataset = chart.data.datasets[0];
        const total = dataset.data.reduce((a, b) => a + b, 0);
        if (!total) return;

        chart.getDatasetMeta(0).data.forEach((element, i) => {
            const val = dataset.data[i];
            const pct = Math.round((val / total) * 100);
            if (pct < 4) return;
            const { x, y } = element.tooltipPosition();
            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 4;
            ctx.fillText(`${pct}%`, x, y);
            ctx.restore();
        });
    }
};

async function loadFromCloudflareKV() {
    try {
        const res = await fetch(DB_URL, { headers: { 'X-Master-Key': SECRET_KEY } });
        const data = await res.json();

        if (Object.keys(data).length === 0) {
            return true;
        }

        appData.twStocks = [];
        appData.usStocks = [];
        appData.cash = Number(data.cash) || 0;
        appData.netWorthHistory = data.netWorthHistory || [];
        appData.transactions = data.transactions || [];
        appData.valuations = data.valuations || {};
        try {
            const localVal = localStorage.getItem('wealth_valuations');
            if (localVal && Object.keys(appData.valuations).length === 0) {
                appData.valuations = JSON.parse(localVal);
            }
        } catch(e) {}

        if (data.holdings) {
            data.holdings.forEach(h => {
                const obj = {
                    symbol: h.symbol,
                    shares: parseFloat(h.shares) || 0,
                    costPrice: parseFloat(h.costPrice) || 0,
                    currentPrice: null,
                    prevClose: null,
                    isError: true
                };
                if (h.market === 'TW') appData.twStocks.push(obj);
                else if (h.market === 'US') appData.usStocks.push(obj);
            });
        }

        isDataInitialized = true;
        return true;
    } catch (e) {
        console.error("讀取雲端失敗:", e);
        return false;
    }
}

async function saveToCloud() {
    const payload = {
        cash: appData.cash,
        netWorthHistory: appData.netWorthHistory,
        transactions: appData.transactions,
        holdings: [
            ...appData.twStocks.map(s => ({ market: 'TW', symbol: s.symbol, shares: s.shares, costPrice: s.costPrice })),
            ...appData.usStocks.map(s => ({ market: 'US', symbol: s.symbol, shares: s.shares, costPrice: s.costPrice }))
        ],
        valuations: appData.valuations || {}
    };

    try {
        const res = await fetch(DB_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': SECRET_KEY },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
            showToast('⚡ 邊緣金庫同步成功');
            changelog.length = 0;
            return true;
        }
        throw new Error(result.error || '寫入失敗');
    } catch (e) {
        showToast('❌ 儲存失敗');
        throw e;
    }
}

async function fetchHybridYahooQuotes(symbolsArray) {
    if (symbolsArray.length === 0) return {};
    const priceMap = {};
    let missing = [...symbolsArray];
    const proxies = [url => `${WORKER_URL}${encodeURIComponent(url)}`];

    for (let p of proxies) {
        try {
            const res = await fetch(p(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsArray.join(',')}`));
            if (!res.ok) continue;
            const data = await res.json();
            data.quoteResponse.result.forEach(i => {
                priceMap[i.symbol] = {
                    price: i.regularMarketPrice,
                    prevClose: i.regularMarketPreviousClose,
                    time: i.regularMarketTime * 1000,
                    state: i.marketState
                };
                missing = missing.filter(s => s !== i.symbol);
            });
            break;
        } catch (e) { }
    }

    if (missing.length > 0) {
        await Promise.all(missing.map(async sym => {
            for (let p of proxies) {
                try {
                    const res = await fetch(p(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`));
                    if (!res.ok) continue;
                    const meta = (await res.json()).chart.result[0].meta;
                    if (meta.regularMarketPrice) {
                        priceMap[sym] = {
                            price: meta.regularMarketPrice,
                            prevClose: meta.chartPreviousClose,
                            time: meta.regularMarketTime * 1000,
                            state: 'CLOSED'
                        };
                        return;
                    }
                } catch (e) { }
            }
        }));
    }
    return priceMap;
}

async function fetchPricesAndRender(forceRefresh = false) {
    const fetchTWSE = async () => {
        if (twseDataMap && !forceRefresh) return;
        try {
            const symbols = appData.twStocks.map(s => `tse_${s.symbol}.tw`).join('|');
            if (!symbols) return;

            const apiUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${symbols}&json=1&delay=0&_=${Date.now()}`;
            const proxyUrl = `${WORKER_URL}${encodeURIComponent(apiUrl)}`;

            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            twseDataMap = {};
            if (data.msgArray) {
                data.msgArray.forEach(item => {
                    if (item.code && (item.z || item.y)) {
                        const code = item.code.replace(/^tse_|tw$/gi, '');
                        twseDataMap[code] = parseFloat(item.z) || parseFloat(item.y);
                    }
                });
            }
        } catch (e) {
            console.error("MIS Proxy 失敗:", e);
            twseDataMap = {};
        }
    };

    const yfReq = ['TWD=X', ...appData.twStocks.map(s => s.symbol + '.TW'), ...appData.usStocks.map(s => s.symbol)];
    const [_, yfData] = await Promise.all([fetchTWSE(), fetchHybridYahooQuotes(yfReq)]);

    if (yfData['TWD=X']?.price) appData.settings.usdToTwd = yfData['TWD=X'].price;
    const exRateDisplay = $('exchange-rate-display');
    if (exRateDisplay) exRateDisplay.innerText = `匯率 USD/TWD = ${appData.settings.usdToTwd.toFixed(2)}`;

    const bindPrice = (stock, isUS) => {
        const sym = isUS ? stock.symbol : `${stock.symbol}.TW`;
        const q = yfData[sym];

        if (!isUS && twseDataMap?.[stock.symbol]) {
            stock.currentPrice = twseDataMap[stock.symbol];
            stock.isError = false;
            if (q?.prevClose) stock.prevClose = q.prevClose;
        } else if (q?.price) {
            stock.currentPrice = q.price;
            stock.prevClose = q.prevClose || stock.prevClose;
            stock.isError = false;
            appData.marketTime[isUS ? 'us' : 'tw'] = Math.max(
                appData.marketTime[isUS ? 'us' : 'tw'] || 0,
                q.time || 0
            );
        } else {
            stock.isError = true;
        }
    };

    appData.twStocks.forEach(s => bindPrice(s, false));
    appData.usStocks.forEach(s => bindPrice(s, true));

    renderApp();
    if (currentTab === 'allocation') renderAllocationView();
    if (currentTab === 'valuation') renderValuationView();
    if (currentTab === 'tracking') renderTrackingChart();
    if (currentTab === 'transactions') renderEditHoldingsView();
}

async function refreshData(forceRefresh = false) {
    $('syncBtn').classList.add('spin');
    $('last-update').innerText = "載入中...";
    try {
        await loadFromCloudflareKV();
        await fetchPricesAndRender(forceRefresh);
        $('last-update').innerText = `同步完成：${fmtTime(new Date().getTime())}`;

        if (appData.twStocks.length > 0 || appData.usStocks.length > 0) {
            $('history-list-container').innerHTML = '<div class="empty-state">背景運算中...</div>';
            loadHistoryData();
        } else {
            $('history-list-container').innerHTML = '<div class="empty-state">目前無部位</div>';
        }
    } catch (e) {
        $('last-update').innerText = "載入失敗";
    } finally {
        $('syncBtn').classList.remove('spin');
    }
}

const renderStockList = (stocks, isUS) => stocks.map(s => {
    const cost = s.costPrice * s.shares;
    const net = (s.isError ? 0 : s.currentPrice) * s.shares;
    const profit = net - cost;
    const exRate = isUS ? appData.settings.usdToTwd : 1;

    appData.totals[isUS ? 'usNet' : 'twNet'] += (net * exRate);

    const priceStr = s.isError ? '⚠️阻擋' : (isUS ? '$' : '') + (s.currentPrice || 0).toFixed(2);
    const netStr = s.isError ? '--' : 'NT$ ' + fmtM(net * exRate);
    const profitPct = cost === 0 ? 0 : (profit / cost) * 100;
    const profitStr = s.isError ? '--' : 'NT$ ' + fmtM(profit * exRate) + ' (' + fmtP(profitPct).replace(/[()%]+/g, '') + '%)';

    return `
        <div class="list-item">
            <div class="item-col">
                <span class="item-main">${s.symbol}</span>
                <span class="item-sub">${fmtMax3(s.shares)} 股</span>
            </div>
            <div class="item-col text-center">
                <span class="item-main ${s.isError ? 'color-down' : ''}">${priceStr}</span>
                <span class="item-sub">現價</span>
            </div>
            <div class="item-col text-right">
                <span class="item-main">${netStr}</span>
                <span class="item-sub reduced-font">
                    <span class="${clr(profit)}">${profitStr}</span>
                </span>
            </div>
        </div>
    `;
}).join('');

function renderApp() {
    appData.totals.twNet = 0;
    appData.totals.usNet = 0;

    const twCost = appData.twStocks.reduce((sum, s) => sum + s.costPrice * s.shares, 0);
    const usCost = appData.usStocks.reduce((sum, s) => sum + s.costPrice * s.shares * appData.settings.usdToTwd, 0);

    $('tw-list').innerHTML = renderStockList(appData.twStocks, false) || '<div class="list-item">無部位</div>';
    $('us-list').innerHTML = renderStockList(appData.usStocks, true) || '<div class="list-item">無部位</div>';

    const tNet = appData.totals.twNet;
    const uNet = appData.totals.usNet;

    appData.totals.stockCost = twCost + usCost;
    appData.totals.stockNet = tNet + uNet;
    appData.totals.grandCost = appData.totals.stockCost;
    appData.totals.grandNet = appData.totals.stockNet + appData.cash;

    let fastTodayProfit = 0;
    const calcFastDaily = (s, isUS) => {
        if (!s.isError && s.prevClose && s.currentPrice) {
            fastTodayProfit += (s.currentPrice - s.prevClose) * s.shares * (isUS ? appData.settings.usdToTwd : 1);
        }
    };
    appData.twStocks.forEach(s => calcFastDaily(s, false));
    appData.usStocks.forEach(s => calcFastDaily(s, true));
    appData.totals.todayProfit = fastTodayProfit;

    updateHeroBanner(currentTab);
    if (currentTab === 'dashboard') renderAllocationChart();
    if (currentTab === 'allocation') renderAllocationView();

    animateVal("tw-net", tNet);
    animateVal("us-net", uNet);
    animateVal("cash-total", appData.cash);

    $('tw-cost').innerText = fmtM(twCost);
    $('tw-roi').innerText = fmtP(twCost === 0 ? 0 : (tNet - twCost) / twCost * 100);
    $('tw-roi').className = `card-roi num ${clr(tNet - twCost)}`;

    $('us-cost').innerText = 'NT$ ' + fmtM(usCost);
    $('us-roi').innerText = fmtP(usCost === 0 ? 0 : (uNet - usCost) / usCost * 100);
    $('us-roi').className = `card-roi num ${clr(uNet - usCost)}`;

    $('tw-update-time').innerText = `報價：${fmtTime(appData.marketTime.tw)}`;
    $('us-update-time').innerText = `報價：${fmtTime(appData.marketTime.us)}`;
}

function updateHeroBanner(v) {
    const isSt = (v === 'history' || v === 'transactions');
    const isTracking = (v === 'tracking');
    const isHistory = (v === 'history');
    const isAlloc = (v === 'allocation');
    const isValuation = (v === 'valuation');

    if ($('hero-main-title')) {
        if (isValuation) {
            $('hero-main-title').innerText = '股票估值與目標管理';
        } else if (isAlloc) {
            $('hero-main-title').innerText = '資產總覽與配比';
        } else if (isSt) {
            $('hero-main-title').innerText = '股票資產總淨值';
        } else {
            $('hero-main-title').innerText = '總資產淨值';
        }
    }

    const mainAmount = isSt ? appData.totals.stockNet : appData.totals.grandNet;
    animateVal("grand-total", mainAmount);

    const subInfo = document.querySelector('.hero-sub-info');
    if (!subInfo) return;

    if (isValuation) {
        const totalCount = appData.twStocks.length + appData.usStocks.length;
        const valKeys = Object.keys(appData.valuations || {});
        const setValCount = valKeys.filter(k => appData.valuations[k] && appData.valuations[k].targetPrice > 0).length;
        subInfo.innerHTML = `
            <div><span style="color: #2C3E50; font-weight: 600;">追蹤標的</span><strong class="num" style="color: var(--text-navy);">${totalCount} 檔</strong></div>
            <div><span style="color: #5B8DB8; font-weight: 600;">已設目標</span><strong class="num" style="color: #C5A059;">${setValCount} 檔</strong></div>
            <div><span style="color: #549B7B; font-weight: 600;">匯率 USD/TWD</span><strong class="num" style="color: var(--text-navy);">${(appData.settings.usdToTwd || 31.5).toFixed(2)}</strong></div>
        `;
    } else if (isTracking || isAlloc) {
        subInfo.innerHTML = `
            <div><span style="color: #2C3E50; font-weight: 600;">台股部位</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.totals.twNet)}</strong></div>
            <div><span style="color: #5B8DB8; font-weight: 600;">美股部位</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.totals.usNet)}</strong></div>
            <div><span style="color: #C5A059; font-weight: 600;">現金資產</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.cash)}</strong></div>
        `;
    } else if (isHistory) {
        let twToday = 0;
        let usToday = 0;
        appData.twStocks.forEach(s => {
            if (!s.isError && s.prevClose && s.currentPrice) twToday += (s.currentPrice - s.prevClose) * s.shares;
        });
        appData.usStocks.forEach(s => {
            if (!s.isError && s.prevClose && s.currentPrice) usToday += (s.currentPrice - s.prevClose) * s.shares * appData.settings.usdToTwd;
        });

        subInfo.innerHTML = `
            <div><span style="color: var(--text-muted);">台股今日損益</span><strong class="num ${clr(twToday)}">${twToday > 0 ? '+' : ''}${fmtM(twToday)}</strong></div>
            <div><span style="color: var(--text-muted);">美股今日損益</span><strong class="num ${clr(usToday)}">${usToday > 0 ? '+' : ''}${fmtM(usToday)}</strong></div>
        `;
    } else {
        const roi = appData.totals.grandCost === 0 ? 0 :
            ((appData.totals.stockNet - appData.totals.stockCost) / (isSt ? appData.totals.stockCost : appData.totals.grandCost)) * 100;
        const tp = appData.totals.todayProfit || 0;

        subInfo.innerHTML = `
            <div><span>總投資成本</span><strong class="num" id="grand-cost">${fmtM(appData.totals.grandCost)}</strong></div>
            <div><span>總報酬率</span><strong class="num ${clr(roi)}" id="grand-roi">${fmtP(roi)}</strong></div>
            <div><span>今日損益</span><strong class="num ${clr(tp)}" id="today-profit">${tp > 0 ? '+' : ''}${fmtM(tp)}</strong></div>
        `;
    }
}

function navTo(target, el) {
    currentTab = target;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');

    ['dashboard', 'allocation', 'valuation', 'tracking', 'history', 'info', 'transactions'].forEach(t => {
        const contentDiv = $(t + '-content');
        if (contentDiv) {
            contentDiv.classList[target === t ? 'remove' : 'add']('hide');
        }
    });

    const heroSection = document.querySelector('.hero-section');
    if (heroSection) {
        if (target === 'info') {
            heroSection.classList.add('hide');
        } else {
            heroSection.classList.remove('hide');
            updateHeroBanner(target);
        }
    }

    if (target === 'dashboard') renderAllocationChart();
    else if (target === 'allocation') renderAllocationView();
    else if (target === 'valuation') renderValuationView();
    else if (target === 'history' && !isHistoryLoaded && (appData.twStocks.length > 0 || appData.usStocks.length > 0)) loadHistoryData();
    else if (target === 'tracking') renderTrackingChart();
    else if (target === 'transactions') renderEditHoldingsView();
    else if (target === 'info') renderInfoView();
}

function toggleCard(id) {
    const el = $(id);
    if (el) el.classList.toggle('expanded');
}

function animateVal(id, end) {
    const el = $(id);
    if (!el) return;
    let start = parseInt(el.innerText.replace(/,/g, '')) || 0, st = null;

    const step = ts => {
        if (!st) st = ts;
        let p = Math.min((ts - st) / 800, 1);
        el.innerText = fmtM(Math.floor((1 - Math.pow(1 - p, 4)) * (end - start) + start));
        if (p < 1) requestAnimationFrame(step);
        else el.innerText = fmtM(end);
    };
    requestAnimationFrame(step);
}

// 🌟 1. 【首頁】圓餅圖：標籤改為「現金資產」＋ 圖表直接標註整數百分比
function renderAllocationChart() {
    const d = [appData.totals.twNet, appData.totals.usNet, appData.cash];

    if (chartInst.allocation) {
        chartInst.allocation.data.datasets[0].data = d;
        chartInst.allocation.update();
    } else {
        const ctx = $('allocationChart');
        if (!ctx) return;

        chartInst.allocation = new Chart(ctx, {
            type: 'doughnut',
            plugins: [doughnutPercentagePlugin],
            data: {
                labels: ['台股資產', '美股資產', '現金資產'],
                datasets: [{
                    data: d,
                    backgroundColor: ['#C5A059', '#D96B6B', '#3A4A63'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 16,
                            font: { family: 'Inter', size: 12 },
                            generateLabels: function(chart) {
                                const data = chart.data;
                                const tot = data.datasets[0].data.reduce((acc, v) => acc + v, 0);
                                return data.labels.map((label, i) => {
                                    const val = data.datasets[0].data[i] || 0;
                                    const pct = tot > 0 ? Math.round((val / tot) * 100) : 0;
                                    return {
                                        text: `${label} ${pct}%`,
                                        fillStyle: data.datasets[0].backgroundColor[i],
                                        strokeStyle: data.datasets[0].backgroundColor[i],
                                        pointStyle: 'circle',
                                        hidden: false,
                                        index: i
                                    };
                                });
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: c => {
                                const tot = c.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = tot > 0 ? Math.round((c.raw / tot) * 100) : 0;
                                return ` ${c.label}: NT$ ${fmtM(c.raw)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

// 🌟 2. 【追蹤】折線圖通用設定：動態偵測跨月邊界，修復 8 月及 10 月縱向格線
const getChartOpt = (monthBoundaryIndices = new Set()) => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { bottom: 10 } },
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { display: false },
        tooltip: {
            enabled: false,
            external: function (context) {
                if (window.innerWidth <= 768) {
                    let tooltipEl = $('custom-chart-tooltip');
                    if (tooltipEl) tooltipEl.style.opacity = 0;
                    return;
                }

                let tooltipEl = $('custom-chart-tooltip');
                if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'custom-chart-tooltip';
                    tooltipEl.style.background = 'rgba(26, 36, 54, 0.9)';
                    tooltipEl.style.borderRadius = '8px';
                    tooltipEl.style.color = 'white';
                    tooltipEl.style.opacity = 0;
                    tooltipEl.style.pointerEvents = 'none';
                    tooltipEl.style.position = 'absolute';
                    tooltipEl.style.transform = 'translate(-100%, 0)';
                    tooltipEl.style.transition = 'all .15s ease';
                    tooltipEl.style.zIndex = 9999;
                    tooltipEl.style.padding = '12px';
                    tooltipEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    tooltipEl.style.fontFamily = 'Inter, sans-serif';
                    document.body.appendChild(tooltipEl);
                }

                const tooltipModel = context.tooltip;
                if (tooltipModel.opacity === 0) {
                    tooltipEl.style.opacity = 0;
                    return;
                }

                if (tooltipModel.body) {
                    const titleLines = tooltipModel.title || [];
                    let innerHtml = `<div style="font-weight:bold; margin-bottom:12px; font-size:14px; color:#8A94A6; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">${titleLines[0]}</div>`;
                    innerHtml += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px;">`;

                    tooltipModel.dataPoints.forEach(function (dp, i) {
                        const colors = tooltipModel.labelColors[i];
                        const borderColor = colors.borderColor;
                        const val = Math.round(dp.parsed.y).toLocaleString();
                        const label = dp.dataset.label;

                        innerHtml += `
                            <div style="display:flex; flex-direction:column; min-width: 120px;">
                                <div style="display:flex; align-items:center; font-size:12px; color:#E2E8F0; margin-bottom:4px;">
                                    <span style="display:inline-block; width:10px; height:10px; margin-right:6px; background:${borderColor}; border-radius:2px;"></span>
                                    <span>${label}</span>
                                </div>
                                <span style="font-weight:bold; color:#fff; font-size:14px; margin-left:16px;">NT$ ${val}</span>
                            </div>
                        `;
                    });

                    innerHtml += `</div>`;
                    tooltipEl.innerHTML = innerHtml;
                }

                const chart = context.chart;
                tooltipEl.style.opacity = 1;
                const position = chart.canvas.getBoundingClientRect();
                const chartCenterX = position.left + window.scrollX + position.width / 2;
                const chartCenterY = position.top + window.scrollY + position.height / 2;

                tooltipEl.style.transform = 'translate(-50%, -260%)';
                tooltipEl.style.left = chartCenterX + 'px';
                tooltipEl.style.top = chartCenterY + 'px';
            }
        }
    },
    scales: {
        y: {
            ticks: { font: { size: 10, family: 'Inter' }, callback: v => (v / 10000).toFixed(0) + '萬' },
            grid: { color: 'rgba(26,36,54,0.05)' }
        },
        x: {
            ticks: {
                font: { size: 10, family: 'Inter' },
                autoSkip: false,
                maxRotation: 0,
                minRotation: 0,
                callback: function (value, index) {
                    if (monthBoundaryIndices.has(index)) {
                        return this.getLabelForValue(value);
                    }
                    return null;
                }
            },
            grid: {
                display: true,
                drawTicks: true,
                tickLength: 6,
                tickWidth: 2,
                drawOnChartArea: true,
                borderDash: [5, 5],
                borderDashOffset: 0,
                lineWidth: function (context) {
                    return monthBoundaryIndices.has(context.index) ? 1.5 : 0;
                },
                color: function (context) {
                    if (monthBoundaryIndices.has(context.index)) {
                        return 'rgba(100, 116, 139, 0.45)';
                    }
                    return 'rgba(0, 0, 0, 0)';
                }
            }
        }
    }
});

function drawLineChart(chartInstance, ctxId, labels, datasetsConfig) {
    if (chartInstance) chartInstance.destroy();
    const ctx = $(ctxId);
    if (!ctx) return null;

    // 動態偵測跨月邊界點 (只要跨月就判定邊界，8月、10月不再遺漏)
    const monthBoundaryIndices = new Set();
    let prevMonthStr = '';

    labels.forEach((lbl, idx) => {
        const parts = lbl.split(/[-/]/);
        if (parts.length >= 2) {
            const mStr = parts[0] + '-' + parts[1];
            if (mStr !== prevMonthStr) {
                monthBoundaryIndices.add(idx);
                prevMonthStr = mStr;
            }
        } else if (idx === 0) {
            monthBoundaryIndices.add(idx);
        }
    });

    const options = getChartOpt(monthBoundaryIndices);

    if (datasetsConfig.length > 1) {
        options.plugins.legend = {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
                boxWidth: 6,
                boxHeight: 6,
                usePointStyle: true,
                font: { size: 10, family: 'Inter' },
                color: '#8A94A6'
            }
        };
    } else {
        options.plugins.legend = { display: false };
    }

    const chartDatasets = datasetsConfig.map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.bg,
        borderWidth: ds.isBenchmark ? 1.5 : 2,
        pointBackgroundColor: '#cddef404',
        pointBorderColor: ds.color,
        pointRadius: 0,
        fill: ds.bg !== 'transparent',
        tension: 0,
        yAxisID: ds.yAxisID || 'y'
    }));

    return new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: chartDatasets },
        options: options
    });
}

// 🌟 3. 【追蹤】歷史走勢圖：動態起點歸一化，解決 006208 與 SPY 失真
async function renderTrackingChart() {
    animateVal("tracking-stock-total", appData.totals.stockNet);
    animateVal("tracking-cash-total", appData.cash);
    const hist = appData.netWorthHistory || [];

    if (hist.length === 0) {
        const emptyHTML = '<div class="chart-empty">尚無紀錄</div>';
        $('nw-box').innerHTML = emptyHTML + '<canvas id="netWorthChart" style="display:none;"></canvas>';
        $('st-box').innerHTML = emptyHTML + '<canvas id="stockNetChart" style="display:none;"></canvas>';
        $('cs-box').innerHTML = emptyHTML + '<canvas id="cashNetChart" style="display:none;"></canvas>';
        if (chartInst.nw) chartInst.nw.destroy();
        if (chartInst.stock) chartInst.stock.destroy();
        if (chartInst.cash) chartInst.cash.destroy();
        return;
    }

    ['netWorthChart', 'stockNetChart', 'cashNetChart'].forEach(id => {
        const canvas = $(id);
        if (canvas && canvas.style.display === 'none') {
            canvas.parentNode.innerHTML = `<canvas id="${id}"></canvas>`;
        }
    });

    const lbls = hist.map(i => {
        let d = new Date(i.date);
        return isNaN(d.getTime()) ? i.date : `${d.getFullYear().toString().slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    const nwData = hist.map(i => i.grandNet);
    const stockData = hist.map(i => i.stockNet || (i.grandNet - (i.cash || 0)));
    const cashData = hist.map(i => i.cash);

    let nwDatasets = [
        { label: '總資產', data: nwData, color: '#C5A059', bg: 'rgba(197,160,89,0.1)' }
    ];
    let stockDatasets = [
        { label: '股票資產', data: stockData, color: '#549B7B', bg: 'rgba(84,155,123,0.1)' }
    ];

    chartInst.nw = drawLineChart(chartInst.nw, 'netWorthChart', lbls, nwDatasets);
    chartInst.stock = drawLineChart(chartInst.stock, 'stockNetChart', lbls, stockDatasets);
    chartInst.cash = drawLineChart(chartInst.cash, 'cashNetChart', lbls, [
        { label: '現金資產', data: cashData, color: '#3A4A63', bg: 'rgba(58,74,99,0.1)' }
    ]);

    // 抓取基準線資料並執行精確的動態起點歸一化
    const bench = await fetchBenchmarkData();
    if (bench && bench['006208'].length > 0 && bench['SPY'].length > 0) {
        const matchPrice = (targetDateStr, benchHistory) => {
            const targetTime = new Date(targetDateStr).getTime();
            let closest = benchHistory[0]?.price || 0;
            let minDiff = Infinity;
            for (let b of benchHistory) {
                const diff = Math.abs(b.time - targetTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = b.price;
                }
            }
            return closest;
        };

        const rawData6208 = hist.map(i => matchPrice(i.date, bench['006208']));
        const rawDataSPY = hist.map(i => matchPrice(i.date, bench['SPY']));

        // 以歷史第一筆的實際淨值作為起點，不再寫死固定金額
        const baseNwTarget = nwData[0] || 0;
        const baseStockTarget = stockData[0] || 0;

        const normalize = (rawData, targetAmt) => {
            const basePrice = rawData[0];
            if (!basePrice || !targetAmt) return rawData;
            return rawData.map(price => (price / basePrice) * targetAmt);
        };

        if (baseNwTarget > 0) {
            nwDatasets.push({
                label: '006208 (總資產對照)',
                data: normalize(rawData6208, baseNwTarget),
                color: 'rgba(243, 156, 18, 0.75)',
                bg: 'transparent',
                isBenchmark: true
            });
            nwDatasets.push({
                label: 'SPY (總資產對照)',
                data: normalize(rawDataSPY, baseNwTarget),
                color: 'rgba(155, 89, 182, 0.75)',
                bg: 'transparent',
                isBenchmark: true
            });
            chartInst.nw = drawLineChart(chartInst.nw, 'netWorthChart', lbls, nwDatasets);
        }

        if (baseStockTarget > 0) {
            stockDatasets.push({
                label: '006208 (股票對照)',
                data: normalize(rawData6208, baseStockTarget),
                color: 'rgba(243, 156, 18, 0.75)',
                bg: 'transparent',
                isBenchmark: true
            });
            stockDatasets.push({
                label: 'SPY (股票對照)',
                data: normalize(rawDataSPY, baseStockTarget),
                color: 'rgba(155, 89, 182, 0.75)',
                bg: 'transparent',
                isBenchmark: true
            });
            chartInst.stock = drawLineChart(chartInst.stock, 'stockNetChart', lbls, stockDatasets);
        }
    }
}

async function saveCurrentNetWorth() {
    if (appData.totals.grandNet <= 0) return showToast('⚠️ 總資產異常');
    $('saveNwBtn').disabled = true;
    $('saveNwBtn').innerText = '儲存中...';

    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    appData.netWorthHistory.push({
        date: dateStr,
        grandNet: Number(appData.totals.grandNet) || 0,
        stockNet: Number(appData.totals.stockNet) || 0,
        cash: Number(appData.cash) || 0
    });

    renderTrackingChart();

    try {
        await saveToCloud();
        showToast('📈 存檔成功！');
    } catch (e) {
        appData.netWorthHistory.pop();
        renderTrackingChart();
    } finally {
        $('saveNwBtn').disabled = false;
        $('saveNwBtn').innerText = '💾 紀錄現值';
    }
}

// 🌟 4. 【績效】手機響應式優化：新增 5日(%) 排序，欄位順序調為 [代號, 當日%, 5日%, 22日%, 累計%]
async function loadHistoryData() {
    isHistoryLoaded = true;
    $('history-progress-container').style.display = 'block';
    appData.history = [];

    const stocks = [...appData.twStocks.map(s => ({ ...s, m: 'TW' })), ...appData.usStocks.map(s => ({ ...s, m: 'US' }))];
    const tot = stocks.length;
    let cur = 0;
    const px = [u => `${WORKER_URL}${encodeURIComponent(u)}`];

    for (let s of stocks) {
        await sleep(80);
        const sym = s.m === 'TW' ? `${s.symbol}.TW` : s.symbol;
        let ok = false;

        for (let p of px) {
            if (ok) break;
            try {
                const res = await fetch(p(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=6mo`));
                if (!res.ok) continue;

                const cList = (await res.json()).chart.result[0].indicators.quote[0].close.filter(c => c != null);

                if (s.currentPrice && cList.length > 5) {
                    const getHist = d => {
                        if (cList.length <= d) return 0;
                        const histPrice = cList[cList.length - 1 - d];
                        if (!histPrice) return 0;
                        return ((s.currentPrice - histPrice) / histPrice) * 100;
                    };

                    const d1r = s.prevClose ? ((s.currentPrice - s.prevClose) / s.prevClose * 100) : 0;
                    const hist5 = getHist(5);
                    const hist22 = getHist(22);
                    const totalCost = s.costPrice * s.shares;
                    const totalNet = s.currentPrice * s.shares;
                    const totalProfitPct = totalCost > 0 ? ((totalNet - totalCost) / totalCost) * 100 : 0;

                    const exRate = s.m === 'US' ? appData.settings.usdToTwd : 1;
                    const pD1 = s.prevClose ? (s.currentPrice - s.prevClose) * s.shares * exRate : 0;
                    const totalProfitAmt = (totalNet - totalCost) * exRate;

                    appData.history.push({
                        market: s.m,
                        symbol: s.symbol,
                        d1: d1r,
                        d5: hist5,
                        d22: hist22,
                        totalProfitPct: totalProfitPct,
                        pD1: pD1,
                        totalProfitAmt: totalProfitAmt
                    });
                    ok = true;
                }
            } catch (e) { }
        }
        cur++;
        $('history-progress').style.width = `${(cur / tot) * 100}%`;
        $('history-status').innerText = `計算矩陣 ${cur}/${tot}...`;
    }
    $('history-progress-container').style.display = 'none';
    $('history-status').innerText = "運算完成";
    renderHistory();
}

function setHeroMode(m, el) {
    currentHeroMode = m;
    document.querySelectorAll('.history-controls .hero-btn').forEach(b => b.classList.remove('active-hero'));
    el.classList.add('active-hero');
    renderHistory();
}

function renderHistory() {
    const div = $('history-list-container');
    if (!appData.history.length) return div.innerHTML = '<div class="empty-state">無數據</div>';

    let d = [...appData.history];
    if (currentHeroMode === 'default') {
        d.sort((a, b) => {
            if (a.market === 'TW' && b.market !== 'TW') return -1;
            if (a.market !== 'TW' && b.market === 'TW') return 1;
            return a.symbol.localeCompare(b.symbol);
        });
    } else if (currentHeroMode === 'd1Pct') {
        d.sort((a, b) => b.d1 - a.d1);
    } else if (currentHeroMode === 'd5Pct') {
        d.sort((a, b) => b.d5 - a.d5); // 🌟 支援 5日(%) 排行
    } else if (currentHeroMode === 'd22Pct') {
        d.sort((a, b) => b.d22 - a.d22);
    } else if (currentHeroMode === 'totalPct') {
        d.sort((a, b) => b.totalProfitPct - a.totalProfitPct);
    }

    const fPct = v => `<span class="${clr(v)}">${fmtP(v)}</span>`;

    // 整體組合報酬率計算
    const sumCost = appData.totals.stockCost || 1;
    const sumNet = appData.totals.stockNet || 0;
    const totalRoi = ((sumNet - sumCost) / sumCost) * 100;
    const totalD1Pct = sumNet > 0 ? (appData.totals.todayProfit / sumNet) * 100 : 0;

    // 🌟 手機版精簡 5 欄 Grid：代號、當日(%)、5日(%)、22日(%)、累計(%)
    const gridCols = "1.2fr 1fr 1fr 1fr 1fr";

    let h = `
        <div class="history-grid" style="color:var(--text-muted); border-bottom:2px solid var(--border-light); padding-bottom:8px; grid-template-columns: ${gridCols}; font-size:12px;">
            <div class="col-name">代號</div>
            <div class="text-right">當日(%)</div>
            <div class="text-right">5日(%)</div>
            <div class="text-right">22日(%)</div>
            <div class="text-right">累計(%)</div>
        </div>
        <div class="history-grid" style="background:rgba(197,160,89,0.08); border-radius:6px; padding:10px 8px; margin:8px 0; border:none; grid-template-columns: ${gridCols};">
            <div class="col-name" style="color:var(--accent-gold); font-size:13px;">組合總計</div>
            <div class="num text-right" style="font-weight:700;">${fPct(totalD1Pct)}</div>
            <div class="text-right color-muted">-</div>
            <div class="text-right color-muted">-</div>
            <div class="num text-right" style="font-weight:700;">${fPct(totalRoi)}</div>
        </div>
    `;

    d.forEach(i => {
        h += `
            <div class="history-grid" style="grid-template-columns: ${gridCols};">
                <div class="col-name num font-bold">${i.symbol}</div>
                <div class="num text-right">${fPct(i.d1)}</div>
                <div class="num text-right">${fPct(i.d5)}</div>
                <div class="num text-right">${fPct(i.d22)}</div>
                <div class="num text-right">${fPct(i.totalProfitPct)}</div>
            </div>
        `;
    });
    div.innerHTML = h;
}

// 🌟 5. 【資產配比】新分頁：完整實作四桶投資框架、穿透計算與再平衡警示
function calculateBucketsData() {
    const totalGrandNet = appData.totals.grandNet || 1;
    const exRate = appData.settings.usdToTwd || 31.5;

    const findHolding = (symbol, market) => {
        const pool = market === 'TW' ? appData.twStocks : appData.usStocks;
        return pool.find(s => s.symbol === symbol);
    };

    const bucketsResult = {};
    const alertList = [];

    for (const [bKey, bDef] of Object.entries(FOUR_BUCKETS)) {
        let bucketTotalTwd = 0;
        const holdingsDetails = [];

        if (bKey === 'cash') {
            if (appData.cash > 0) {
                bucketTotalTwd += appData.cash;
                holdingsDetails.push({
                    symbol: 'TWD 現金',
                    sub: '流動現金',
                    market: 'TW',
                    shares: 1,
                    priceStr: '1.00',
                    twdNet: appData.cash
                });
            }
        }

        for (const [sym, info] of Object.entries(bDef.symbols)) {
            const h = findHolding(sym, info.market);
            if (h && h.shares > 0) {
                const price = h.isError ? h.costPrice : (h.currentPrice || h.costPrice);
                const isUS = info.market === 'US';
                const twdVal = price * h.shares * (isUS ? exRate : 1);

                bucketTotalTwd += twdVal;
                holdingsDetails.push({
                    symbol: sym,
                    sub: info.sub,
                    market: info.market,
                    shares: h.shares,
                    priceStr: (isUS ? '$ ' : '') + price.toFixed(2),
                    twdNet: twdVal
                });
            }
        }

        const pct = (bucketTotalTwd / totalGrandNet) * 100;
        let status = 'in-range';
        let actionIcon = '→';
        let actionText = '合理，無須動作';

        if (bKey === 'core') {
            if (pct < bDef.targetMin) {
                status = 'need-buy';
                actionIcon = '↑';
                const diffAmt = (totalGrandNet * (bDef.targetMid / 100)) - bucketTotalTwd;
                actionText = `低於 40% 下限，須優先補 (缺口約 NT$ ${fmtM(diffAmt)})`;
                alertList.push({
                    type: 'warning',
                    msg: `<strong>Core Beta 偏低 (${pct.toFixed(1)}%)</strong>：低於 40% 下限值，建議自 現金/債部位 分批回補約 NT$ ${fmtM(diffAmt)}，優先補 VTI、006208。`
                });
            } else if (pct > bDef.targetMax) {
                status = 'need-trim';
                actionIcon = '↓';
                actionText = `高於 45% 上限 (年度再平衡時再移)`;
            }
        } else if (bKey === 'growth') {
            if (pct >= bDef.hardMax) {
                status = 'hard-cap';
                actionIcon = '🚨';
                const diffAmt = bucketTotalTwd - (totalGrandNet * (bDef.targetMax / 100));
                actionText = `超過上限值，請立即調整平衡 (超額約 NT$ ${fmtM(diffAmt)})`;
                alertList.push({
                    type: 'danger',
                    msg: `<strong>Growth Beta 嚴重偏高 (${pct.toFixed(1)}%)</strong>：已超過 30% 高度曝險！超額約 NT$ ${fmtM(diffAmt)} 必須移出：若 Core 偏低先補 Core，否則進 現金/債部位。`
                });
            } else if (pct > bDef.targetMax) {
                status = 'need-trim';
                actionIcon = '↓';
                const diffAmt = bucketTotalTwd - (totalGrandNet * (bDef.targetMid / 100));
                actionText = `超出 25% 上限 (超額約 NT$ ${fmtM(diffAmt)})`;
                alertList.push({
                    type: 'warning',
                    msg: `<strong>Growth Beta 超出區間 (${pct.toFixed(1)}%)</strong>：風險預算放大，建議移出超額 NT$ ${fmtM(diffAmt)} 至 Core 或 SGOV。`
                });
            } else if (pct < bDef.targetMin) {
                status = 'need-buy';
                actionIcon = '↑';
                actionText = `低於 20% (優先補Core Beta，再補這裡)`;
            }
        } else if (bKey === 'alpha') {
            if (pct > bDef.hardMax) {
                status = 'hard-cap';
                actionIcon = '🚨';
                const diffAmt = bucketTotalTwd - (totalGrandNet * (bDef.targetMax / 100));
                actionText = `超過 15% 限制，已曝險過高 (超額約 NT$ ${fmtM(diffAmt)})`;
                alertList.push({
                    type: 'danger',
                    msg: `<strong>Alpha 突破 15% 硬頂 (${pct.toFixed(1)}%)</strong>：超額約 NT$ ${fmtM(diffAmt)} 必須立即減碼漲多標的，資金回流 SGOV，切勿轉入 Growth。`
                });
            }
        } else if (bKey === 'cash') {
            if (pct < bDef.hardMin) {
                status = 'hard-cap';
                actionIcon = '🚨';
                actionText = `低於20%下限 目前防禦不足`;
                alertList.push({
                    type: 'danger',
                    msg: `<strong>現金／債 嚴重不足 (${pct.toFixed(1)}%)</strong>：已低於 15% ！防禦力不足，嚴禁再動用任何資金抄底。`
                });
            } else if (pct < bDef.targetMin) {
                status = 'need-buy';
                actionIcon = '↑';
                actionText = `低於 20% (防禦已不足)`;
                alertList.push({
                    type: 'warning',
                    msg: `<strong>現金／債 偏低 (${pct.toFixed(1)}%)</strong>：低於 20% 防禦下緣，目前子彈打太滿，暫停主動加碼。`
                });
            } else if (pct > bDef.targetMax) {
                status = 'in-range';
                actionIcon = '→';
                actionText = `超過上限值 (機會成本已偏高)`;
            }
        }

        bucketsResult[bKey] = {
            ...bDef,
            totalTwd: bucketTotalTwd,
            pct: pct,
            status: status,
            actionIcon: actionIcon,
            actionText: actionText,
            holdings: holdingsDetails
        };
    }

    return { buckets: bucketsResult, alerts: alertList, totalGrandNet };
}

function renderAllocationView() {
    const { buckets, alerts, totalGrandNet } = calculateBucketsData();

    // 1. 渲染警示看板
    const alertBox = $('rebalance-alert-box');
    if (alertBox) {
        if (alerts.length === 0) {
            alertBox.innerHTML = `
                <div class="alert-banner alert-ok">
                    <i class="fa-solid fa-circle-check mt-2" style="font-size:16px;"></i>
                    <div><strong>區塊配置皆在安全警示區間內</strong><br>請維持紀律，中間的市場波動不構成動作條件。</div>
                </div>
            `;
        } else {
            alertBox.innerHTML = alerts.map(a => `
                <div class="alert-banner alert-${a.type}">
                    <i class="fa-solid ${a.type === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'} mt-2" style="font-size:16px;"></i>
                    <div>${a.msg}</div>
                </div>
            `).join('');
        }
    }

    // 2. 渲染雙層長條圖
    const summarySpan = $('alloc-actual-summary');
    if (summarySpan) {
        summarySpan.innerHTML = `Core ${buckets.core.pct.toFixed(0)}% ｜ Growth ${buckets.growth.pct.toFixed(0)}% ｜ Alpha ${buckets.alpha.pct.toFixed(0)}% ｜ 現金/債 ${buckets.cash.pct.toFixed(0)}%`;
    }

    const actualBar = $('alloc-actual-bar');
    if (actualBar) {
        actualBar.innerHTML = `
            <div class="bar-seg bar-seg-core" style="width: ${buckets.core.pct}%;" title="Core Beta: ${buckets.core.pct.toFixed(1)}%"></div>
            <div class="bar-seg bar-seg-growth" style="width: ${buckets.growth.pct}%;" title="Growth Beta: ${buckets.growth.pct.toFixed(1)}%"></div>
            <div class="bar-seg bar-seg-alpha" style="width: ${buckets.alpha.pct}%;" title="Alpha: ${buckets.alpha.pct.toFixed(1)}%"></div>
            <div class="bar-seg bar-seg-cash" style="width: ${buckets.cash.pct}%;" title="現金／債: ${buckets.cash.pct.toFixed(1)}%"></div>
        `;
    }

    // 3. 渲染四大桶現況卡片與明細
    const cardsList = $('bucket-cards-list');
    if (!cardsList) return;

    const bucketKeys = ['core', 'growth', 'alpha', 'cash'];
    cardsList.innerHTML = bucketKeys.map(k => {
        const b = buckets[k];
        const tagClass = b.status === 'in-range' ? 'tag-in-range' :
                        (b.status === 'need-buy' ? 'tag-need-buy' :
                        (b.status === 'hard-cap' ? 'tag-hard-cap' : 'tag-need-trim'));

        const holdingsRows = b.holdings.length === 0
            ? '<div class="empty-state" style="padding:10px 0;">目前無此桶部位</div>'
            : b.holdings.map(h => {
                const hBucketPct = b.totalTwd > 0 ? (h.twdNet / b.totalTwd * 100).toFixed(1) : '0.0';
                const hTotalPct = (h.twdNet / totalGrandNet * 100).toFixed(1);
                return `
                    <div class="bucket-sub-item">
                        <div>
                            <strong>${h.symbol}</strong>
                            <span class="color-muted" style="font-size:11px; margin-left:6px;">${h.sub}</span>
                        </div>
                        <div class="text-right">
                            <span class="num font-bold">NT$ ${fmtM(h.twdNet)}</span>
                            <div class="color-muted num" style="font-size:11px;">桶佔 ${hBucketPct}% · 總資產 ${hTotalPct}%</div>
                        </div>
                    </div>
                `;
            }).join('');

        return `
            <div class="card bucket-card bucket-${k}" id="card-bucket-${k}" onclick="toggleCard('card-bucket-${k}')">
                <div class="card-header cursor-pointer">
                    <div class="card-title-group">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <h2 class="card-title" style="margin-bottom:0;">${b.name}</h2>
                            <span class="allocation-tag ${tagClass}">${b.actionIcon} ${b.actionText}</span>
                        </div>
                        <span class="card-subtitle" style="margin-top:4px;">${b.subtitle} ｜ 目標 ${b.targetMin}%～${b.targetMax}%</span>
                    </div>
                    <div class="text-right">
                        <div class="card-value num">NT$ ${fmtM(b.totalTwd)}</div>
                        <div class="card-roi num font-bold" style="color: ${b.color};">${b.pct.toFixed(1)}%</div>
                    </div>
                </div>

                <div class="list-container" style="padding-top: 10px;">
                    <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px; border-bottom:1px solid var(--border-light); padding-bottom:4px;">
                        包含標的與子分類明細：
                    </div>
                    ${holdingsRows}
                </div>

                <div class="card-toggle-icon"><i class="fa-solid fa-chevron-down"></i></div>
            </div>
        `;
    }).join('');
}

// 🌟 6. 【編輯】持股部位管理
function renderEditHoldingsView() {
    const container = $('edit-holdings-list');
    if (!container) return;

    const cashInput = $('edit-page-cash-input');
    if (cashInput) cashInput.value = appData.cash;

    const allHoldings = [
        ...appData.twStocks.map(s => ({ ...s, market: 'TW' })),
        ...appData.usStocks.map(s => ({ ...s, market: 'US' }))
    ];

    if (allHoldings.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px 15px;">無持股資料，請點擊下方加入。</div>`;
        return;
    }

    container.innerHTML = allHoldings.map(holding => {
        const symbolWithMarket = `${holding.symbol}.${holding.market}`;
        const marketLabel = holding.market === 'TW'
            ? `<span style="color: #C5A059; font-size: 0.65em; font-weight: 600;">台股</span>`
            : `<span style="color: #D96B6B; font-size: 0.65em; font-weight: 600;">美股</span>`;

        return `
        <div class="edit-item" data-symbol="${symbolWithMarket}">
            <div class="edit-symbol" style="line-height: 1.3;">${marketLabel}<br>${holding.symbol}</div>
            <div class="edit-inputs">
                <div class="edit-input-wrapper">
                    <span class="edit-label">持有股數</span>
                    <input type="number" class="edit-input shares-input" value="${holding.shares}">
                </div>
                <div class="edit-input-wrapper">
                    <span class="edit-label">平均成本</span>
                    <input type="number" step="any" class="edit-input cost-input" value="${holding.costPrice.toFixed(4)}">
                </div>
            </div>
            <button class="btn-remove-stock" onclick="removeHolding(this)"><i class="fa-solid fa-trash-can"></i></button>
        </div>
        `;
    }).join('');
}

function addHolding() {
    const symbolInput = $('new-holding-symbol');
    const fullSymbol = symbolInput.value.trim().toUpperCase();
    if (!fullSymbol || !fullSymbol.includes('.')) {
        showToast('⚠️ 請輸入完整代號 (例如: 2330.TW 或 AAPL.US)');
        return;
    }

    const [symbol, market] = fullSymbol.split('.');
    if (!symbol || !['TW', 'US'].includes(market)) {
        showToast('⚠️ 市場別錯誤，僅支援 .TW 或 .US');
        return;
    }

    const exists = [...appData.twStocks, ...appData.usStocks].some(s => s.symbol === symbol);
    if (exists) {
        showToast(`⚠️ ${symbol} 已存在於持股清單中`);
        return;
    }

    const newHolding = {
        symbol: symbol,
        shares: 0,
        costPrice: 0,
        currentPrice: null,
        prevClose: null,
        isError: true
    };

    if (market === 'TW') appData.twStocks.push(newHolding);
    else appData.usStocks.push(newHolding);

    renderEditHoldingsView();
    showToast(`✅ 已加入 ${fullSymbol}，請填寫股數與成本後儲存`);
    symbolInput.value = '';
}

function removeHolding(buttonElement) {
    const itemElement = buttonElement.closest('.edit-item');
    if (!itemElement) return;

    const fullSymbol = itemElement.getAttribute('data-symbol');
    if (!confirm(`確定要從編輯列表中移除 ${fullSymbol} 嗎？\n此操作需點擊下方儲存按鈕才會同步至雲端。`)) {
        return;
    }

    itemElement.remove();
    showToast(`🗑️ 已自列表移除 ${fullSymbol}`);

    const container = $('edit-holdings-list');
    if (container.children.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 20px 15px;">無持股資料，請點擊下方加入。</div>`;
    }
}

async function saveHoldings() {
    const saveBtn = $('save-holdings-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...';

    const newTwStocks = [];
    const newUsStocks = [];
    const holdingElements = document.querySelectorAll('#edit-holdings-list .edit-item');

    let hasError = false;
    holdingElements.forEach(el => {
        const fullSymbol = el.getAttribute('data-symbol');
        const shares = parseFloat(el.querySelector('.shares-input').value);
        const costPrice = parseFloat(el.querySelector('.cost-input').value);

        if (!fullSymbol || isNaN(shares) || isNaN(costPrice)) {
            hasError = true;
            return;
        }

        const [symbol, market] = fullSymbol.split('.');
        const holding = {
            symbol: symbol,
            shares: shares,
            costPrice: costPrice,
            currentPrice: null,
            prevClose: null,
            isError: true
        };

        if (market === 'TW') newTwStocks.push(holding);
        else if (market === 'US') newUsStocks.push(holding);
    });

    if (hasError) {
        showToast('❌ 部分資料格式錯誤，請檢查後再儲存');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 儲存所有變更至雲端';
        return;
    }

    const cashInput = $('edit-page-cash-input');
    const newCashValue = parseFloat(cashInput.value);
    if (isNaN(newCashValue)) {
        showToast('❌ 現金部位格式錯誤');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 儲存所有變更至雲端';
        return;
    }

    appData.cash = newCashValue;
    appData.twStocks = newTwStocks;
    appData.usStocks = newUsStocks;

    try {
        await saveToCloud();
        showToast('✅ 持股與現金已同步至雲端！');
        isHistoryLoaded = false;
        await fetchPricesAndRender();
    } catch (e) {
        showToast(`❌ 儲存失敗: ${e.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 儲存所有變更至雲端';
    }
}

// 🌟 7. 【資訊】全球監控與三大法人籌碼
async function renderInfoView() {
    const symbols = {
        'twii': '^TWII',
        'gspc': '^GSPC',
        'txf': 'EWT',
        'twdx': 'TWD=X',
        'vix': '^VIX',
        'oil': 'BZ=F',
        'tsm': 'TSM',
        'tnx': '^TNX',
        'futw': 'FTCRTWNT.FGI'
    };

    const priceMap = await fetchHybridYahooQuotes(Object.values(symbols));

    for (const [id, sym] of Object.entries(symbols)) {
        const data = priceMap[sym];
        if (data) {
            const chg = data.price - data.prevClose;
            const pct = (chg / data.prevClose) * 100;

            const valEl = id === 'futw' ? $('info-futw-val') :$(`mkt-${id}`);
            const chgEl = id === 'futw' ? $('info-futw-chg') :$(`mkt-${id}-chg`);
            const timeEl = id === 'futw' ? $('info-futw-time') :$(`mkt-${id}-time`);

            if (valEl) valEl.innerText = data.price.toLocaleString(undefined, { minimumFractionDigits: 2 });
            if (chgEl) {
                chgEl.innerText = `${chg > 0 ? '+' : ''}${chg.toFixed(2)} (${fmtP(pct)})`;
                chgEl.className = `market-chg num ${clr(chg)}`;
            }

            if (timeEl) {
                const d = new Date(data.time);
                const timeStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

                let stateStr = '收盤';
                let stateColor = '#8A94A6';
                let stateIcon = '🌑';

                const now = new Date().getTime();
                const diffMins = Math.abs(now - data.time) / (1000 * 60);
                const is24hMarket = ['TWD=X', 'BZ=F', '^VIX'].includes(sym);
                const isLive = (data.state === 'REGULAR') || (is24hMarket && diffMins < 45) || (!data.state && diffMins < 30);

                if (isLive) {
                    stateStr = '盤中';
                    stateColor = '#549B7B';
                    stateIcon = '🟢';
                } else if (data.state === 'PRE' || data.state === 'PREPRE') {
                    stateStr = '盤前';
                    stateColor = '#C5A059';
                    stateIcon = '🟡';
                } else if (data.state === 'POST') {
                    stateStr = '盤後';
                    stateColor = '#3A4A63';
                    stateIcon = '🔵';
                }

                timeEl.innerHTML = `<span style="color: ${stateColor}; font-size: 12px; font-weight: 500;">${stateIcon} ${stateStr} ${timeStr}</span>`;
            }
        }
    }

    await fetchInstitutionalData();
}

async function fetchInstitutionalData() {
    try {
        const apiUrl = `https://www.twse.com.tw/fund/BFI82U?response=json&type=day&_=${Date.now()}`;
        const proxyUrl = `${WORKER_URL}${encodeURIComponent(apiUrl)}`;

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('無法取得證交所資料');

        const json = await res.json();
        if (json.stat !== 'OK' || !json.data) throw new Error('三大法人資料格式異常');

        let reportDate = "最新交易日";
        if (json.date && json.date.length === 8) {
            reportDate = `${json.date.substring(0, 4)}/${json.date.substring(4, 6)}/${json.date.substring(6, 8)}`;
        }

        const parseToYi = str => parseInt(str.replace(/,/g, ''), 10) / 100000000;

        let dealer = 0, trust = 0, foreign = 0;
        json.data.forEach(row => {
            const name = row[0];
            const netVal = parseToYi(row[3]);
            if (name.includes('自營商(自行買賣)') || name.includes('自營商(避險)')) dealer += netVal;
            else if (name.includes('投信')) trust = netVal;
            else if (name.includes('外資及陸資') || name.includes('外資自營商')) foreign += netVal;
        });

        const updateChipCard = (elementId, dateId, value) => {
            const el = $(elementId);
            const dateEl = $(dateId);
            if (!el) return;

            const displayStr = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
            el.textContent = displayStr;
            el.className = 'market-val num ' + (value > 0 ? 'color-up' : (value < 0 ? 'color-down' : ''));
            if (dateEl) dateEl.textContent = reportDate;
        };

        updateChipCard('info-foreign-val', 'info-foreign-date', foreign);
        updateChipCard('info-trust-val', 'info-trust-date', trust);
        updateChipCard('info-dealer-val', 'info-dealer-date', dealer);
    } catch (error) {
        console.error('抓取籌碼資料失敗:', error);
        ['info-foreign-val', 'info-trust-val', 'info-dealer-val'].forEach(id => {
            if ($(id))$(id).textContent = '暫無資料';
        });
    }
}

async function fetchBenchmarkData() {
    if (appData.benchmarkData) return appData.benchmarkData;
    try {
        const px = url => `${WORKER_URL}${encodeURIComponent(url)}`;
        const fetchSym = async (sym) => {
            const res = await fetch(px(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2y`));
            if (!res.ok) return [];
            const json = await res.json();
            const result = json.chart.result[0];
            const timestamps = result.timestamp;
            const closes = result.indicators.quote[0].close;
            return timestamps.map((t, i) => ({ time: t * 1000, price: closes[i] })).filter(d => d.price != null);
        };
        const [twData, usData] = await Promise.all([fetchSym('006208.TW'), fetchSym('SPY')]);
        appData.benchmarkData = { '006208': twData, 'SPY': usData };
        return appData.benchmarkData;
    } catch (e) {
        console.error("抓取基準線資料失敗", e);
        return null;
    }
}

async function saveCash() {
    const val = parseFloat($('edit-cash-input')?.value);
    if (!isNaN(val)) {
        appData.cash = val;
        renderApp();
        try {
            await saveToCloud();
            showToast('💰 現金已同步至雲端');
        } catch (e) {
            showToast('❌ 雲端儲存失敗');
        }
    }
}

window.onload = () => refreshData(false);

// 🌟 8. 【估值】標的目標價與評估理由管理
function getHoldingSubtitle(symbol) {
    for (const b of Object.values(FOUR_BUCKETS)) {
        if (b.symbols && b.symbols[symbol]) {
            return b.symbols[symbol].sub;
        }
    }
    return '';
}

function cacheCurrentValuationInputs() {
    const container = $('valuation-list-container');
    if (!container) return;
    const items = container.querySelectorAll('.valuation-item');
    items.forEach(el => {
        const symbol = el.getAttribute('data-symbol');
        const market = el.getAttribute('data-market');
        const targetInput = el.querySelector('.valuation-target-price');
        const reasonInput = el.querySelector('.valuation-reason');
        if (!symbol || !targetInput || !reasonInput) return;

        const targetPriceVal = targetInput.value !== '' ? parseFloat(targetInput.value) : null;
        const reasonVal = reasonInput.value.trim();

        if (targetPriceVal !== null || reasonVal !== '') {
            if (!appData.valuations[symbol]) {
                appData.valuations[symbol] = {
                    targetPrice: targetPriceVal,
                    reason: reasonVal,
                    market: market,
                    updatedAt: new Date().toISOString()
                };
            } else {
                appData.valuations[symbol].targetPrice = targetPriceVal;
                appData.valuations[symbol].reason = reasonVal;
                appData.valuations[symbol].market = market;
            }
        }
    });
}

function updateValuationUpside(symbol, currentPrice) {
    const itemEl = document.querySelector(`.valuation-item[data-symbol="${symbol}"]`);
    if (!itemEl) return;
    const targetInput = itemEl.querySelector('.valuation-target-price');
    const upsideEl = itemEl.querySelector('.valuation-upside');
    if (!targetInput || !upsideEl) return;

    const targetVal = parseFloat(targetInput.value);
    if (isNaN(targetVal) || targetVal <= 0 || !currentPrice || currentPrice <= 0) {
        upsideEl.innerText = '--';
        upsideEl.className = 'valuation-upside upside-flat';
        return;
    }

    const upsidePct = ((targetVal - currentPrice) / currentPrice) * 100;
    const sign = upsidePct > 0 ? '+' : '';
    upsideEl.innerText = `${sign}${upsidePct.toFixed(1)}%`;
    if (upsidePct > 0) {
        upsideEl.className = 'valuation-upside upside-up';
    } else if (upsidePct < 0) {
        upsideEl.className = 'valuation-upside upside-down';
    } else {
        upsideEl.className = 'valuation-upside upside-flat';
    }
}

function filterValuations(keyword) {
    const q = (keyword || '').trim().toLowerCase();
    const items = document.querySelectorAll('#valuation-list-container .valuation-item');
    items.forEach(el => {
        const symbol = (el.getAttribute('data-symbol') || '').toLowerCase();
        const sub = (el.getAttribute('data-sub') || '').toLowerCase();
        if (!q || symbol.includes(q) || sub.includes(q)) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
}

function renderValuationView() {
    cacheCurrentValuationInputs();

    const container = $('valuation-list-container');
    if (!container) return;

    const allStocks = [
        ...appData.twStocks.map(s => ({ ...s, market: 'TW' })),
        ...appData.usStocks.map(s => ({ ...s, market: 'US' }))
    ];

    const totalCountEl = $('val-total-count');
    const setCountEl = $('val-set-count');
    if (totalCountEl) totalCountEl.innerText = allStocks.length;

    let setCount = 0;
    allStocks.forEach(s => {
        const rec = appData.valuations && appData.valuations[s.symbol];
        if (rec && rec.targetPrice && rec.targetPrice > 0) setCount++;
    });
    if (setCountEl) setCountEl.innerText = setCount;

    if (allStocks.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 20px 15px;">目前無持股標的，請至「編輯」頁面新增標的。</div>';
        return;
    }

    container.innerHTML = allStocks.map(s => {
        const isUS = s.market === 'US';
        const curPrice = s.currentPrice || 0;
        const curPriceStr = s.isError ? '連線中...' : (isUS ? '$ ' : 'NT$ ') + (curPrice ? curPrice.toFixed(2) : '--');
        const subDesc = getHoldingSubtitle(s.symbol);

        const savedVal = (appData.valuations && appData.valuations[s.symbol]) || {};
        const targetVal = savedVal.targetPrice !== undefined && savedVal.targetPrice !== null ? savedVal.targetPrice : '';
        const reasonVal = savedVal.reason || '';
        const updatedTimeStr = savedVal.updatedAt ? fmtTime(new Date(savedVal.updatedAt).getTime()) : '';

        let upsideText = '--';
        let upsideClass = 'upside-flat';
        if (targetVal !== '' && curPrice > 0) {
            const upPct = ((parseFloat(targetVal) - curPrice) / curPrice) * 100;
            const sign = upPct > 0 ? '+' : '';
            upsideText = `${sign}${upPct.toFixed(1)}%`;
            upsideClass = upPct > 0 ? 'upside-up' : (upPct < 0 ? 'upside-down' : 'upside-flat');
        }

        const badgeClass = isUS ? 'badge-us' : 'badge-tw';
        const badgeText = isUS ? '美股' : '台股';

        return `
            <div class="valuation-item" data-symbol="${s.symbol}" data-market="${s.market}" data-sub="${subDesc}">
                <div class="valuation-header-row">
                    <div class="valuation-stock-info">
                        <span class="valuation-badge ${badgeClass}">${badgeText}</span>
                        <span class="valuation-symbol">${s.symbol}</span>
                    </div>
                    <div class="valuation-price-box">
                        <span class="valuation-price-label">最新成交價</span>
                        <span class="valuation-current-price num ${s.isError ? 'color-down' : ''}">${curPriceStr}</span>
                    </div>
                </div>

                <div class="valuation-inputs-grid">
                    <div class="valuation-input-wrapper">
                        <div class="valuation-input-label">
                            <span>目標價</span>
                            <span class="valuation-upside ${upsideClass}">${upsideText}</span>
                        </div>
                        <input type="number" step="any" class="valuation-input valuation-target-price"
                            placeholder="輸入目標價"
                            value="${targetVal !== '' ? targetVal : ''}"
                            oninput="updateValuationUpside('${s.symbol}', ${curPrice})">
                    </div>

                    <div class="valuation-input-wrapper">
                        <div class="valuation-input-label">
                            <span>評估理由 / 投資備忘</span>
                            ${updatedTimeStr ? `<span style="font-size:10px; color:#A0AEC0;">更新：${updatedTimeStr}</span>` : '<span></span>'}
                        </div>
                        <input type="text" class="valuation-input valuation-reason"
                            placeholder="填寫目標價推算邏輯、產業催化劑或停損利標準..."
                            value="${escapeHtml(reasonVal)}">
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const searchInput = $('valuation-search-input');
    if (searchInput && searchInput.value) {
        filterValuations(searchInput.value);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
}

async function saveValuations() {
    cacheCurrentValuationInputs();

    const saveBtn = $('btn-save-valuations');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 儲存至雲端中...';
    }

    try {
        localStorage.setItem('wealth_valuations', JSON.stringify(appData.valuations));
        await saveToCloud();
        showToast('🎯 估值與目標價已同步至雲端！');
        renderValuationView();
        updateHeroBanner(currentTab);
    } catch (e) {
        showToast(`❌ 估值儲存失敗: ${e.message || e}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 修改完成';
        }
    }
}
