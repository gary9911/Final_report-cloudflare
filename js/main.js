
const WORKER_URL = 'https://proxy-gary0417.gary9911.workers.dev/?url=';
const DB_URL = 'https://proxy-gary0417.gary9911.workers.dev/';
const SECRET_KEY = 'MySuperSecretWealth2026';

const $ = id => document.getElementById(id);

const appData = {
    cash: 0,
    settings: { usdToTwd: 31.5 },
    twStocks: [],
    usStocks: [],
    history: [],
    netWorthHistory: [],
    transactions: [],
    totals: { grandNet: 0, grandCost: 0, stockNet: 0, stockCost: 0, twNet: 0, usNet: 0 },
    marketTime: { tw: null, us: null }
};

let twseDataMap = null;
let isHistoryLoaded = false;
let isDataInitialized = false;
let currentHeroMode = 'default';
let currentTab = 'dashboard';
let chartInst = { allocation: null, nw: null, stock: null, cash: null };
const changelog = [];
let draftTxs = [];

const fmtM = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });     // 整數金額
const fmtMax2 = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });  // 小數點2位 (金額/均價)
const fmtMax3 = n => n.toLocaleString('en-US', { maximumFractionDigits: 3 });  // 小數點3位 (股數)
const fmtP = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const clr = n => n > 0 ? 'color-up' : (n < 0 ? 'color-down' : '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const showToast = msg => {
    $('toast').innerText = msg;
    $('toast').classList.add('show');
    setTimeout(() => $('toast').classList.remove('show'), 2500);
};

const setCloudStatus = (state, msg) => {
    $('cloud-status').className = 'cloud-status ' + state;
    $('cloud-status-text').innerText = msg;
};

const fmtTime = ms => {
    if (!ms) return "依最新收盤價";
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function loadFromCloudflareKV() {
    setCloudStatus('syncing', '讀取邊緣金庫中...');
    try {
        const res = await fetch(DB_URL, { headers: { 'X-Master-Key': SECRET_KEY } });
        const data = await res.json();

        if (Object.keys(data).length === 0) {
            setCloudStatus('synced', '全新金庫，請新增持股');
            return true;
        }

        appData.twStocks = [];
        appData.usStocks = [];
        appData.cash = data.cash || 0;
        appData.netWorthHistory = data.netWorthHistory || [];
        appData.transactions = data.transactions || [];

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
        setCloudStatus('synced', `已載入資料`);
        return true;
    } catch (e) {
        setCloudStatus('error', '雲端尚無資料或連線失敗');
        return false;
    }
}

async function saveToCloud() {
    $('saveCloudBtn').disabled = true;
    $('saveCloudBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 極速寫入中...';
    setCloudStatus('syncing', '寫入邊緣金庫中...');

    const payload = {
        cash: appData.cash,
        netWorthHistory: appData.netWorthHistory,
        transactions: appData.transactions,
        holdings: [
            ...appData.twStocks.map(s => ({ market: 'TW', symbol: s.symbol, shares: s.shares, costPrice: s.costPrice })),
            ...appData.usStocks.map(s => ({ market: 'US', symbol: s.symbol, shares: s.shares, costPrice: s.costPrice }))
        ]
    };

    try {
        const res = await fetch(DB_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': SECRET_KEY },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
            setCloudStatus('synced', '✅ 極速儲存成功');
            showToast('⚡ 邊緣節點已同步！');
            changelog.length = 0;
            renderChangelog();
        } else {
            throw new Error(result.error);
        }
    } catch (e) {
        setCloudStatus('error', '❌ 寫入失敗');
        showToast('❌ 寫入失敗');
    } finally {
        $('saveCloudBtn').disabled = false;
        $('saveCloudBtn').innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 儲存至邊緣金庫';
    }
}
async function renderInfoView() {
    const symbols = {
        'twii': '^TWII',  // 台灣大盤
        'gspc': '^GSPC',  // S&P 500
        'ewt': 'EWT',     // 摩台 ETF
        'twdx': 'TWD=X',  // USD/TWD
        'vix': '^VIX',    // VIX 指數
        'oil': 'BZ=F'     // Brent 原油
    };

    const priceMap = await fetchHybridYahooQuotes(Object.values(symbols));
    
    for (const [id, sym] of Object.entries(symbols)) {
        const data = priceMap[sym];
        if (data) {
            const chg = data.price - data.prevClose;
            const pct = (chg / data.prevClose) * 100;
            
            $(`mkt-${id}`).innerText = data.price.toLocaleString(undefined, {minimumFractionDigits: 2});
            $(`mkt-${id}-chg`).innerText = `${chg > 0 ? '+' : ''}${chg.toFixed(2)} (${fmtP(pct)})`;
            $(`mkt-${id}-chg`).className = `market-chg num ${clr(chg)}`;
        }
    }
    // CNN 指數通常需要特殊 API，此處先給予模擬數值
    $('mkt-cnn').innerText = "52"; 
    $('mkt-cnn-chg').innerText = "中性 (Neutral)";
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
                    time: i.regularMarketTime * 1000
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
                            time: meta.regularMarketTime * 1000
                        };
                        return;
                    }
                } catch (e) { }
            }
        }));
    }
    return priceMap;
}

// 🌟 新增 forceRefresh 參數，強制重抓台股資料
async function fetchPricesAndRender(forceRefresh = false) {
    const fetchTWSE = async () => {
        if (twseDataMap && !forceRefresh) return;
        try {
            const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
            const data = await res.json();
            twseDataMap = {};
            data.forEach(s => {
                if (s.ClosingPrice) twseDataMap[s.Code] = parseFloat(s.ClosingPrice);
            });
        } catch (e) {
            twseDataMap = {};
        }
    };

    const yfReq = ['TWD=X', ...appData.twStocks.map(s => s.symbol + '.TW'), ...appData.usStocks.map(s => s.symbol)];
    const [_, yfData] = await Promise.all([fetchTWSE(), fetchHybridYahooQuotes(yfReq)]);

    if (yfData['TWD=X']?.price) appData.settings.usdToTwd = yfData['TWD=X'].price;
    $('exchange-rate-display').innerText = `匯率 USD/TWD = ${appData.settings.usdToTwd.toFixed(2)}`;

    const bindPrice = (stock, isUS) => {
        const sym = isUS ? stock.symbol : `${stock.symbol}.TW`;
        const q = yfData[sym];

        if (q?.prevClose) stock.prevClose = q.prevClose;

        if (!isUS && twseDataMap?.[stock.symbol]) {
            stock.currentPrice = twseDataMap[stock.symbol];
            stock.isError = false;
        } else if (q?.price) {
            stock.currentPrice = q.price;
            stock.isError = false;
            appData.marketTime[isUS ? 'us' : 'tw'] = Math.max(appData.marketTime[isUS ? 'us' : 'tw'] || 0, q.time);
        } else {
            stock.isError = true;
        }
    };

    appData.twStocks.forEach(s => bindPrice(s, false));
    appData.usStocks.forEach(s => bindPrice(s, true));

    renderApp();
    if (currentTab === 'edit') renderEditView();
    if (currentTab === 'tracking') renderTrackingChart();
    if (currentTab === 'transactions') renderTxView();
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

    const priceStr = s.isError ? '⚠️阻擋' : (isUS ? '$' : '') + s.currentPrice.toFixed(2);
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
                        <span class="item-sub reduced-font">${profitStr}</span>
                    </div>
                </div>
            `;
}).join('');

function generateAllocationBarHtml(stocks, isUS) {
    if (!stocks || stocks.length === 0) return '';
    const ex = isUS ? appData.settings.usdToTwd : 1;
    let totalNet = 0;

    const stockData = stocks.map(s => {
        const net = (s.isError ? 0 : s.currentPrice) * s.shares * ex;
        totalNet += net;
        return { symbol: s.symbol, net: net };
    });

    if (totalNet === 0) return '';
    stockData.sort((a, b) => b.net - a.net);

    const colors = ['#C5A059', '#3A4A63', '#549B7B', '#D96B6B', '#8A94A6', '#D4AF37', '#2C3A50', '#76A5AF', '#E06666', '#B4A7D6'];
    let barHtml = '<div class="mini-allocation-bar">';

    stockData.forEach((s, i) => {
        const pct = (s.net / totalNet) * 100;
        if (pct > 0) {
            const color = colors[i % colors.length];
            barHtml += `<div class="mini-bar-segment" style="width: ${pct}%; background-color: ${color};" title="${s.symbol} ${pct.toFixed(1)}%">${s.symbol}</div>`;
        }
    });

    return barHtml + '</div>';
}

function renderApp() {
    appData.totals.twNet = 0;
    appData.totals.usNet = 0;

    const twCost = appData.twStocks.reduce((sum, s) => sum + s.costPrice * s.shares, 0);
    const usCost = appData.usStocks.reduce((sum, s) => sum + s.costPrice * s.shares * appData.settings.usdToTwd, 0);

    $('tw-list').innerHTML = generateAllocationBarHtml(appData.twStocks, false) + (renderStockList(appData.twStocks, false) || '<div class="list-item">無部位</div>');
    $('us-list').innerHTML = generateAllocationBarHtml(appData.usStocks, true) + (renderStockList(appData.usStocks, true) || '<div class="list-item">無部位</div>');

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

/**
 * 更新頂部 Banner (Hero Section) 的數據與文字
 * @param {string} v - 目前切換的分頁 ID
 */
function updateHeroBanner(v) {
    const isSt = (v === 'history' || v === 'edit' || v === 'transactions');
    const isTracking = (v === 'tracking');
    const isHistory = (v === 'history');

    // 1. 更新主標題
    $('hero-main-title').innerText = (isSt || isTracking) ? '股票資產總淨值' : '總資產淨值';

    // 2. 更新主金額
    const mainAmount = (isSt || isTracking) ? appData.totals.stockNet : appData.totals.grandNet;
    animateVal("grand-total", mainAmount);

    const subInfo = document.querySelector('.hero-sub-info');
    if (!subInfo) return;

    if (isTracking) {
        // 🌟 追蹤頁面：文字變色 (金/紅/藍)、數字維持黑色
        subInfo.innerHTML = `
            <div><span style="color: #C5A059; font-weight: 600;">台股資產</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.totals.twNet)}</strong></div>
            <div><span style="color: #D96B6B; font-weight: 600;">美股資產</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.totals.usNet)}</strong></div>
            <div><span style="color: #3A4A63; font-weight: 600;">現金部位</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.cash)}</strong></div>
        `;
    } else if (isHistory) {
        // 🌟 績效頁面：顯示台股/美股今日損益，文字灰色，數字依漲跌變色
        let twToday = 0;
        let usToday = 0;
        
        appData.twStocks.forEach(s => {
            if (!s.isError && s.prevClose && s.currentPrice) {
                twToday += (s.currentPrice - s.prevClose) * s.shares;
            }
        });
        appData.usStocks.forEach(s => {
            if (!s.isError && s.prevClose && s.currentPrice) {
                usToday += (s.currentPrice - s.prevClose) * s.shares * appData.settings.usdToTwd;
            }
        });

        subInfo.innerHTML = `
            <div><span style="color: var(--text-muted);">台股今日損益</span><strong class="num ${clr(twToday)}">${twToday > 0 ? '+' : ''}${fmtM(twToday)}</strong></div>
            <div><span style="color: var(--text-muted);">美股今日損益</span><strong class="num ${clr(usToday)}">${usToday > 0 ? '+' : ''}${fmtM(usToday)}</strong></div>
        `;
    } else {
        // 🌟 預設顯示 (首頁/記帳/編輯)：顯示 總投資成本、總報酬率、今日損益
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

/**
 * 分頁導覽控制
 * @param {string} target - 目標分頁 ID
 * @param {HTMLElement} el - 點擊的導覽列元素
 */
/**
 * 更新後的分頁導覽控制
 * 已移除 'edit' 分頁，並維持 'test' 分頁隱藏 Banner 的邏輯
 */
function navTo(target, el) {
    currentTab = target;

    // 1. 更新導覽列 UI 狀態
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');

    // 2. 切換各分頁內容區塊
    // 將 'test' 改為 'info'
    ['dashboard', 'tracking', 'history', 'transactions', 'info'].forEach(t => {
        const contentDiv = $(t + '-content');
        if (contentDiv) {
            contentDiv.classList[target === t ? 'remove' : 'add']('hide');
        }
    });

    // 3. 控制頂部 Banner (Hero Section)
    const heroSection = document.querySelector('.hero-section');
    if (heroSection) {
        if (target === 'info') {
            heroSection.classList.add('hide'); // 資訊頁面隱藏 Banner
        } else {
            heroSection.classList.remove('hide'); // 其他頁面顯示 Banner
            updateHeroBanner(target);
        }
    }

    // 4. 執行各分頁特定的渲染邏輯
    if (target === 'dashboard') renderAllocationChart();
    else if (target === 'history' && !isHistoryLoaded && (appData.twStocks.length > 0 || appData.usStocks.length > 0)) loadHistoryData();
    else if (target === 'tracking') renderTrackingChart();
    else if (target === 'transactions') renderTxView();
    else if (target === 'info') renderInfoView(); // ⬅️ 加入這一行
}

function toggleCard(id) {
    $(id).classList.toggle('expanded');
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

const getChartOpt = () => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { bottom: 10 } },
    plugins: {
        legend: { display: false },
        tooltip: {
            displayColors: false,
            callbacks: { label: c => 'NT$ ' + c.parsed.y.toLocaleString() }
        }
    },
    scales: {
        y: {
            ticks: { font: { size: 10, family: 'Inter' }, callback: v => (v / 10000).toFixed(0) + '萬' },
            grid: { color: 'rgba(26,36,54,0.05)' }
        },
        x: {
            ticks: { font: { size: 10, family: 'Inter' }, autoSkip: false, maxRotation: 45, minRotation: 45 },
            grid: { display: false }
        }
    }
});

// 🌟 Chart.js 優化：若存在實例，直接銷毀重建，避免記憶體洩漏
function drawLineChart(chartInstance, ctxId, labels, data, label, color, bg) {
    if (chartInstance) chartInstance.destroy();
    const ctx = $(ctxId);
    if (!ctx) return null;

    return new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label,
                data,
                borderColor: color,
                backgroundColor: bg,
                borderWidth: 2,
                pointBackgroundColor: '#1A2436',
                pointBorderColor: color,
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: getChartOpt()
    });
}

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
            data: {
                labels: ['台股資產', '美股資產', '現金'],
                datasets: [{ data: d, backgroundColor: ['#C5A059', '#D96B6B', '#3A4A63'], borderWidth: 0 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20, font: { family: 'Inter', size: 12 } } },
                    tooltip: { callbacks: { label: c => ` NT$ ${c.raw.toLocaleString()} (${Math.round((c.raw / c.dataset.data.reduce((a, b) => a + b, 0)) * 100)}%)` } }
                }
            }
        });
    }
}

function renderTrackingChart() {
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

    // 確保 Canvas 存在 (移除 Empty 狀態)
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

    chartInst.nw = drawLineChart(chartInst.nw, 'netWorthChart', lbls, nwData, '總資產', '#C5A059', 'rgba(197,160,89,0.1)');
    chartInst.stock = drawLineChart(chartInst.stock, 'stockNetChart', lbls, stockData, '股票資產', '#549B7B', 'rgba(84,155,123,0.1)');
    chartInst.cash = drawLineChart(chartInst.cash, 'cashNetChart', lbls, cashData, '現金', '#3A4A63', 'rgba(58,74,99,0.1)');
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

function addChangelog(type, symbol, detail) {
    const ext = changelog.findIndex(c => c.symbol === symbol && c.type === type);
    if (ext !== -1) changelog.splice(ext, 1);
    changelog.push({ type, symbol, detail, time: new Date() });
    renderChangelog();
}

function renderChangelog() {
    $('changelog-badge').innerText = changelog.length;
    $('changelog-badge').className = changelog.length ? 'changelog-badge' : 'changelog-badge empty';

    if (!changelog.length) {
        return $('changelog-body').innerHTML = '<div class="changelog-empty">無變更</div>';
    }

    const tags = { edit: ['EDIT', 'tag-edit'], add: ['NEW', 'tag-add'], del: ['DEL', 'tag-del'], cash: ['現金', 'tag-cash'] };

    $('changelog-body').innerHTML = changelog.map(c => `
                <div class="changelog-row">
                    <div class="changelog-left">
                        <span class="changelog-tag ${tags[c.type]?.[1]}">${tags[c.type]?.[0]}</span>
                        <span class="changelog-symbol">${c.symbol}</span>
                    </div>
                    <div class="changelog-right">${c.detail}</div>
                </div>
            `).join('');
}

function renderEditView() {
    $('edit-cash-input').value = appData.cash;

    const html = (st, m) => {
        if (!st.length) return `<div class="empty-state">目前無部位</div>`;
        return st.map((s, i) => `
                    <div class="edit-item">
                        <div class="edit-symbol">${s.symbol}</div>
                        <div class="edit-inputs">
                            <div class="edit-input-wrapper">
                                <span class="edit-label">股數</span>
                                <input type="number" id="edit-${m}-sh-${i}" class="edit-input" value="${s.shares}">
                            </div>
                            <div class="edit-input-wrapper">
                                <span class="edit-label">成本</span>
                                <input type="number" id="edit-${m}-co-${i}" class="edit-input" value="${s.costPrice.toFixed(2)}">
                            </div>
                        </div>
                        <div class="btn-action-group">
                            <button class="btn-save" onclick="saveStock('${m}',${i})"><i class="fa-solid fa-check"></i></button>
                            <button class="btn-del" onclick="deleteStock('${m}',${i})"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                `).join('');
    };

    $('edit-tw-list').innerHTML = html(appData.twStocks, 'tw');
    $('edit-us-list').innerHTML = html(appData.usStocks, 'us');
    renderChangelog();
}

// 修正後的 saveCash 函式
async function saveCash() {
    const val = parseFloat($('edit-cash-input').value);
    if (!isNaN(val)) {
        // 1. 更新變更紀錄
        addChangelog('cash', 'TWD', `${appData.cash.toLocaleString()} → ${val.toLocaleString()}`);
        
        // 2. 更新記憶體資料
        appData.cash = val;
        
        // 3. 立即渲染畫面（讓使用者看到數字變動）
        renderApp();
        
        // 4. 【關鍵缺失】將資料同步回雲端
        try {
            await saveToCloud(); 
            showToast('💰 現金已同步至雲端');
        } catch (e) {
            showToast('❌ 雲端儲存失敗，請檢查網路');
        }
    }
}

function saveStock(m, i) {
    const sh = parseFloat($(`edit-${m}-sh-${i}`).value);
    const co = parseFloat($(`edit-${m}-co-${i}`).value);

    if (!isNaN(sh) && !isNaN(co)) {
        const a = m === 'tw' ? appData.twStocks : appData.usStocks;
        const s = a[i];
        addChangelog('edit', s.symbol, `股 ${s.shares}→${sh}<br>成 ${s.costPrice.toFixed(2)}→${co.toFixed(2)}`);
        s.shares = sh;
        s.costPrice = co;
        renderApp();
        showToast('✓ 暫存成功');
        isHistoryLoaded = false;
    }
}

function deleteStock(m, i) {
    if (confirm('確定要刪除持股嗎？')) {
        const a = m === 'tw' ? appData.twStocks : appData.usStocks;
        const sym = a[i].symbol;
        a.splice(i, 1);
        renderEditView();
        renderApp();
        addChangelog('del', sym, '已從投資組合移除');
        showToast('移除 ' + sym);
        isHistoryLoaded = false;
    }
}

async function addNewStock() {
    const m = $('add-market').value;
    const sym = $('add-symbol').value.trim().toUpperCase();
    const sh = parseFloat($('add-shares').value);
    const co = parseFloat($('add-cost').value);

    if (!sym || isNaN(sh) || isNaN(co)) return alert('請填寫完整的代號、股數與成本！');

    const obj = {
        symbol: m === 'TW' ? sym.replace(/\.TW$|\.TWO$/i, '') : sym,
        shares: sh,
        costPrice: co,
        currentPrice: null,
        prevClose: null,
        isError: true
    };

    appData[m === 'TW' ? 'twStocks' : 'usStocks'].push(obj);
    ['add-symbol', 'add-shares', 'add-cost'].forEach(id => $(id).value = '');

    addChangelog('add', obj.symbol, `${m} · ${sh}股 · 成本 ${co}`);
    showToast(`已加入 ${obj.symbol}`);

    $('syncBtn').classList.add('spin');
    await fetchPricesAndRender();
    $('syncBtn').classList.remove('spin');
    isHistoryLoaded = false;
}

async function loadHistoryData() {
    isHistoryLoaded = true;
    $('history-progress-container').style.display = 'block';
    appData.history = [];

    const stocks = [...appData.twStocks.map(s => ({ ...s, m: 'TW' })), ...appData.usStocks.map(s => ({ ...s, m: 'US' }))];
    const tot = stocks.length;
    let cur = 0;
    const px = [u => `${WORKER_URL}${encodeURIComponent(u)}`];

    for (let s of stocks) {
        await sleep(100);
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
                        if (cList.length <= d) return { pct: 0, profit: 0 };
                        const histPrice = cList[cList.length - 1 - d];
                        if (!histPrice) return { pct: 0, profit: 0 };
                        const pct = ((s.currentPrice - histPrice) / histPrice) * 100;
                        const exRate = s.m === 'US' ? appData.settings.usdToTwd : 1;
                        const profit = (s.currentPrice - histPrice) * s.shares * exRate;
                        return { pct, profit };
                    };

                    const d1r = s.prevClose ? ((s.currentPrice - s.prevClose) / s.prevClose * 100) : 0;
                    const pD1 = s.prevClose ? (s.currentPrice - s.prevClose) * s.shares * (s.m === 'US' ? appData.settings.usdToTwd : 1) : 0;
                    const hist5 = getHist(5);
                    const hist22 = getHist(22);

                    appData.history.push({ symbol: s.symbol, d1: d1r, d5: hist5.pct, d22: hist22.pct, pD1: pD1, pM1: hist22.profit });
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

    let d = [...appData.history].sort((a, b) => currentHeroMode === 'd1Pct' ? b.d1 - a.d1 : (currentHeroMode === 'd1Profit' ? b.pD1 - a.pD1 : b.pM1 - a.pM1));

    const fPct = v => `<span class="${clr(v)}">${fmtP(v)}</span>`;
    const fPro = v => `<span class="${clr(v)}">${v > 0 ? '+' : ''}${fmtM(v)}</span>`;

    let sumD1 = d.reduce((a, b) => a + (b.pD1 || 0), 0);
    let sumM1 = d.reduce((a, b) => a + (b.pM1 || 0), 0);

    let h = `
                <div class="history-grid" style="color:var(--text-muted); border-bottom:2px solid var(--border-light); padding-bottom:8px;">
                    <div class="col-name">代號</div><div>1日(%)</div><div>5日(%)</div><div>22日(%)</div>
                    <div class="text-right">月損益</div><div class="text-right">日損益</div>
                </div>
                <div class="history-grid" style="background:rgba(197,160,89,0.08); border-radius:6px; padding:10px 8px; margin:8px 0; border:none;">
                    <div class="col-name" style="color:var(--accent-gold);font-size:13px;">組合總計</div><div>-</div><div>-</div><div>-</div>
                    <div class="num text-right" style="font-weight:700;font-size:13px">${fPro(sumM1)}</div>
                    <div class="num text-right" style="font-weight:700;font-size:13px">${fPro(sumD1)}</div>
                </div>
            `;

    d.forEach(i => {
        h += `
                    <div class="history-grid">
                        <div class="col-name num">${i.symbol}</div>
                        <div class="num">${fPct(i.d1)}</div>
                        <div class="num">${fPct(i.d5)}</div>
                        <div class="num">${fPct(i.d22)}</div>
                        <div class="num text-right">${fPro(i.pM1)}</div>
                        <div class="num text-right">${fPro(i.pD1)}</div>
                    </div>
                `;
    });
    div.innerHTML = h;
}

function calcTxPrice() {
    const sh = parseFloat($('tx-shares').value);
    const co = parseFloat($('tx-cost').value);
    $('tx-price').innerText = (sh && co && sh > 0) ? fmtMax2(co / sh) : '0';
}

function clearTxForm() {
    $('tx-shares').value = '';
    $('tx-cost').value = '';
    $('tx-price').innerText = '0';
    $('tx-date').value = new Date().toISOString().split('T')[0];
}

function renderTxView() {
    const allStocks = [...appData.twStocks, ...appData.usStocks];
    const sel = $('tx-symbol');

    sel.innerHTML = allStocks.length
        ? allStocks.map(s => `<option value="${s.symbol}">${s.symbol}</option>`).join('')
        : '<option value="">請先新增持股</option>';

    if (!$('tx-date').value) $('tx-date').value = new Date().toISOString().split('T')[0];

    renderDraftTxs();

    const histDiv = $('stock-tx-histories');
    if (!allStocks.length) {
        return histDiv.innerHTML = '<div class="empty-state">目前無持股可顯示紀錄</div>';
    }

    const types = { buy: ['買進', 'tag-buy'], sell: ['賣出', 'tag-sell'], div: ['配息', 'tag-div'] };
    let histHtml = '';

    allStocks.forEach(s => {
        const stTxs = (appData.transactions || []).filter(t => t.symbol === s.symbol).sort((a, b) => new Date(b.date) - new Date(a.date));

        histHtml += `
                    <div class="card tx-card" id="tx-card-${s.symbol}">
                        <div class="card-header tx-stock-header cursor-default mb-0" onclick="toggleCard('tx-card-${s.symbol}')">
                            <div>
                                <h2 class="card-title">${s.symbol}</h2>
                                <span class="card-subtitle">總股數: <strong class="num">${fmtMax3(s.shares)}</strong></span>
                            </div>
                            <div style="display:flex; align-items:flex-end;">
                                <div class="text-right">
                                    <div class="card-subtitle">均價: <strong class="num">${fmtMax2(s.costPrice)}</strong></div>
                                    <div class="card-subtitle">總成本: <strong class="num">${fmtMax2(s.costPrice * s.shares)}</strong></div>
                                </div>
                                <i class="fa-solid fa-chevron-down tx-expand-icon"></i>
                            </div>
                        </div>
                        <div class="list-container">
                `;

        if (stTxs.length === 0) {
            histHtml += '<div style="text-align:center; padding:12px 10px 0; font-size:11px; color:var(--text-muted);">尚無歷史交易紀錄</div>';
        } else {
            histHtml += `
                        <div style="padding-top:8px;">
                            <div class="tx-grid tx-header">
                                <div>日期</div><div>動作</div><div class="num text-right">股數</div>
                                <div class="num text-right">股價</div><div class="num text-right">金額</div><div class="text-right">操作</div>
                            </div>
                    `;
            stTxs.forEach(tx => {
                const tag = types[tx.type] || ['未知', ''];
                const isDeleting = draftTxs.some(d => d.action === 'delete' && d.originalTx.id === tx.id);
                const priceStr = tx.price ? fmtMax2(tx.price) : '-';
                const costStr = fmtMax2(tx.cost);

                if (isDeleting) {
                    histHtml += `
                                <div class="tx-grid tx-deleted">
                                    <div class="num">${tx.date.substring(5)}</div>
                                    <div><span class="tx-tag ${tag[1]}">${tag[0]}</span></div>
                                    <div class="num text-right">${fmtMax3(tx.shares) || '-'}</div>
                                    <div class="num text-right">${priceStr}</div>
                                    <div class="num text-right">${costStr}</div>
                                    <div class="text-right" style="font-size:10px;">待刪</div>
                                </div>
                            `;
                } else {
                    histHtml += `
                                <div class="tx-grid">
                                    <div class="num">${tx.date.substring(5)}</div>
                                    <div><span class="tx-tag ${tag[1]}">${tag[0]}</span></div>
                                    <div class="num text-right">${fmtMax3(tx.shares) || '-'}</div>
                                    <div class="num text-right">${priceStr}</div>
                                    <div class="num text-right">${costStr}</div>
                                    <div class="text-right">
                                        <button class="tx-action-btn" onclick="editDBTx('${tx.id}')" title="修改"><i class="fa-solid fa-pen"></i></button>
                                        <button class="tx-action-btn" onclick="deleteDBTx('${tx.id}')" title="刪除"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </div>
                            `;
                }
            });
            histHtml += `</div>`;
        }
        histHtml += `</div></div>`;
    });
    histDiv.innerHTML = histHtml;
}

function renderDraftTxs() {
    const dCard = $('draft-tx-card'), dList = $('draft-tx-list');
    if (!draftTxs.length) {
        dCard.classList.add('hide');
        return;
    }
    dCard.classList.remove('hide');

    const types = { buy: ['買進', 'tag-buy'], sell: ['賣出', 'tag-sell'], div: ['配息', 'tag-div'] };

    dList.innerHTML = draftTxs.map((draft, idx) => {
        const tx = draft.action === 'delete' ? draft.originalTx : draft;
        const tag = types[tx.type] || ['未知', ''];
        const actionText = draft.action === 'delete'
            ? `<span class="tx-deleted-text">[刪除]</span><br>`
            : `<span class="tx-added-text">[新增]</span><br>`;
        const priceStr = tx.price ? fmtMax2(tx.price) : '-';
        const costStr = fmtMax2(tx.cost);

        return `
                    <div class="tx-grid" ${draft.action === 'delete' ? 'style="opacity:0.7; text-decoration:line-through;"' : ''}>
                        <div class="num">${tx.date.substring(5)}<br><span class="symbol-mini">${tx.symbol}</span></div>
                        <div>${actionText}<span class="tx-tag ${tag[1]}">${tag[0]}</span></div>
                        <div class="num text-right">${fmtMax3(tx.shares) || '-'}</div>
                        <div class="num text-right">${priceStr}</div>
                        <div class="num text-right">${costStr}</div>
                        <div class="text-right"><button class="tx-action-btn" onclick="removeDraft(${idx})" title="取消"><i class="fa-solid fa-xmark"></i></button></div>
                    </div>
                `;
    }).join('');
}

function stageTx() {
    const sym = $('tx-symbol').value;
    const type = $('tx-type').value;
    const date = $('tx-date').value;
    const sh = parseFloat($('tx-shares').value) || 0;
    const co = parseFloat($('tx-cost').value) || 0;

    if (!sym || !date || (!sh && type !== 'div') || !co) return showToast('⚠️ 請填寫完整交易資訊');

    draftTxs.push({
        action: 'add',
        id: Date.now().toString(),
        symbol: sym,
        type: type,
        date: date,
        shares: sh,
        cost: co,
        price: sh ? co / sh : 0
    });
    clearTxForm();
    renderTxView();
    showToast('✏️ 已寫入新增暫存');
}

function deleteDBTx(id) {
    const tx = appData.transactions.find(t => t.id === id);
    if (!tx) return;
    if (draftTxs.find(d => d.action === 'delete' && d.originalTx.id === id)) return showToast('⚠️ 已在暫存區');

    draftTxs.push({ action: 'delete', originalTx: tx, symbol: tx.symbol });
    renderTxView();

    const card = $(`tx-card-${tx.symbol}`);
    if (card && !card.classList.contains('expanded')) toggleCard(`tx-card-${tx.symbol}`);
    showToast('🗑️ 已排入刪除暫存，請確認寫入');
}

function editDBTx(id) {
    const tx = appData.transactions.find(t => t.id === id);
    if (!tx) return;

    $('tx-symbol').value = tx.symbol;
    $('tx-type').value = tx.type;
    $('tx-date').value = tx.date;
    $('tx-shares').value = tx.shares;
    $('tx-cost').value = tx.cost;
    calcTxPrice();

    deleteDBTx(id);
    showToast('✏️ 已載入表單，舊紀錄排入刪除暫存');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function removeDraft(idx) {
    draftTxs.splice(idx, 1);
    renderTxView();
}

async function commitTransactions() {
    if (!draftTxs.length) return;

    draftTxs.forEach(draft => {
        const isTW = appData.twStocks.find(s => s.symbol === draft.symbol || (draft.originalTx && s.symbol === draft.originalTx.symbol));
        const stock = isTW || appData.usStocks.find(s => s.symbol === draft.symbol || (draft.originalTx && s.symbol === draft.originalTx.symbol));

        if (draft.action === 'delete') {
            const tx = draft.originalTx;
            if (stock) {
                if (tx.type === 'buy') {
                    const totalCost = (stock.shares * stock.costPrice) - tx.cost;
                    stock.shares = Math.max(0, stock.shares - tx.shares);
                    stock.costPrice = stock.shares > 0 ? Math.max(0, totalCost / stock.shares) : 0;
                } else if (tx.type === 'sell') {
                    stock.shares += tx.shares;
                }
            }
            appData.transactions = appData.transactions.filter(t => t.id !== tx.id);

        } else if (draft.action === 'add') {
            const tx = draft;
            if (stock) {
                if (tx.type === 'buy') {
                    const totalCost = (stock.shares * stock.costPrice) + tx.cost;
                    stock.shares += tx.shares;
                    stock.costPrice = stock.shares > 0 ? totalCost / stock.shares : 0;
                } else if (tx.type === 'sell') {
                    stock.shares -= tx.shares;
                    if (stock.shares <= 0) { stock.shares = 0; stock.costPrice = 0; }
                }
            }
            appData.transactions.push({
                id: tx.id,
                symbol: tx.symbol,
                type: tx.type,
                date: tx.date,
                shares: tx.shares,
                cost: tx.cost,
                price: tx.price
            });
        }
    });

    draftTxs = [];
    renderApp();
    renderTxView();
    await saveToCloud();
    showToast('🏦 交易已寫入並同步庫存！(現金請手動調整)');
}

// 初始化
window.onload = () => refreshData(false);

function updateCostPlaceholder() {
    const symbolSelect = $('tx-symbol');
    const costInput = $('tx-cost');
    const selectedVal = symbolSelect.value;

    // 情況 A：選擇「新增監控標的」
    if (selectedVal === 'NEW_ACTION') {
        const market = $('add-market').value;
        costInput.placeholder = (market === 'US') ? "請輸入美金總額 (USD)" : "請輸入台幣總額 (TWD)";
    }
    // 情況 B：尚未選擇
    else if (selectedVal === '') {
        costInput.placeholder = "請選擇標的";
    }
    // 情況 C：選擇現有庫存
    else {
        // 判斷該代號是否存在於美股清單中
        const isUS = appData.usStocks.some(s => s.symbol === selectedVal);
        costInput.placeholder = isUS ? "請輸入美金總額 (USD)" : "請輸入台幣總額 (TWD)";
    }
}
// --- 1. UI 控制：顯示/隱藏新增標的欄位 ---
function toggleNewStockFields() {
    const symbolSelect = $('tx-symbol');
    const extraFields = $('new-stock-extra-fields');

    if (symbolSelect.value === 'NEW_ACTION') {
        extraFields.style.display = 'block';
    } else {
        extraFields.style.display = 'none';
    }
    // 每次切換隱藏/顯示時，重新檢查一次幣別提示
    updateCostPlaceholder();
}

// --- 2. 核心邏輯：處理暫存按鈕點擊 ---
async function handleStageTx() {
    const symbolSelect = $('tx-symbol');
    let targetSymbol = symbolSelect.value;

    // 如果是新增標的模式
    if (targetSymbol === 'NEW_ACTION') {
        const market = $('add-market').value;
        const newSym = $('add-symbol').value.trim().toUpperCase();

        if (!newSym) return alert("請輸入新標的代號！");

        // 檢查是否已經存在於庫存中
        const exists = [...appData.twStocks, ...appData.usStocks].some(s => s.symbol === newSym);
        if (exists) {
            alert("此標的已在庫存中，請直接從下拉選單選擇。");
            symbolSelect.value = newSym;
            toggleNewStockFields();
            return;
        }

        // 建立一個初始標的物件並推入 appData
        const obj = {
            symbol: market === 'TW' ? newSym.replace(/\.TW$|\.TWO$/i, '') : newSym,
            shares: 0,
            costPrice: 0,
            currentPrice: null,
            prevClose: null,
            isError: true
        };

        appData[market === 'TW' ? 'twStocks' : 'usStocks'].push(obj);

        // 加入變更紀錄
        addChangelog('add', obj.symbol, `建立新標的 (${market})`);

        // 重新渲染選單，以便 stageTx 能夠讀取到正確的 symbol
        renderTxView();

        // 將選單選回剛剛建立的那個代號
        $('tx-symbol').value = obj.symbol;
        toggleNewStockFields();

        // 觸發價格更新（非同步，不阻塞暫存）
        fetchPricesAndRender();

        targetSymbol = obj.symbol;
    }

    // 執行原有的 stageTx
    stageTx();
}

// --- 3. 改寫 renderTxView (更新下拉選單結構) ---
function renderTxView() {
    const twStocks = appData.twStocks || [];
    const usStocks = appData.usStocks || [];
    const sel = $('tx-symbol');

    // 獲取目前選中的值（避免渲染時被跳掉）
    const currentVal = sel.value;

    // 重新組合下拉選單 HTML
    let optionsHtml = `
        <option value="">請選擇標的...</option>
        <optgroup label="快捷操作">
            <option value="NEW_ACTION">+ 新增監控標的...</option>
        </optgroup>
    `;

    if (twStocks.length > 0) {
        optionsHtml += `<optgroup label="台股庫存">`;
        optionsHtml += twStocks.map(s => `<option value="${s.symbol}">${s.symbol}</option>`).join('');
        optionsHtml += `</optgroup>`;
    }

    if (usStocks.length > 0) {
        optionsHtml += `<optgroup label="美股庫存">`;
        optionsHtml += usStocks.map(s => `<option value="${s.symbol}">${s.symbol}</option>`).join('');
        optionsHtml += `</optgroup>`;
    }

    sel.innerHTML = optionsHtml;

    // 試著還原先前選中的值
    if (currentVal) sel.value = currentVal;

    // 設定日期預設值
    if (!$('tx-date').value) $('tx-date').value = new Date().toISOString().split('T')[0];

    renderDraftTxs();

    // 渲染下方的歷史紀錄區
    const histDiv = $('stock-tx-histories');
    const allStocks = [...twStocks, ...usStocks];
    if (!allStocks.length) {
        histDiv.innerHTML = '<div class="empty-state">目前無持股可顯示紀錄</div>';
        return;
    }

    const types = { buy: ['買進', 'tag-buy'], sell: ['賣出', 'tag-sell'], div: ['配息', 'tag-div'] };
    let histHtml = '';

    allStocks.forEach(s => {
        const stTxs = (appData.transactions || []).filter(t => t.symbol === s.symbol).sort((a, b) => new Date(b.date) - new Date(a.date));

        histHtml += `
            <div class="card tx-card" id="tx-card-${s.symbol}">
                <div class="card-header tx-stock-header cursor-default mb-0" onclick="toggleCard('tx-card-${s.symbol}')">
                    <div>
                        <h2 class="card-title">${s.symbol}</h2>
                        <span class="card-subtitle">總股數: <strong class="num">${fmtMax3(s.shares)}</strong></span>
                    </div>
                    <div style="display:flex; align-items:flex-end;">
                        <div class="text-right">
                            <div class="card-subtitle">均價: <strong class="num">${fmtMax2(s.costPrice)}</strong></div>
                            <div class="card-subtitle">總成本: <strong class="num">${fmtMax2(s.costPrice * s.shares)}</strong></div>
                        </div>
                        <i class="fa-solid fa-chevron-down tx-expand-icon"></i>
                    </div>
                </div>
                <div class="list-container">
                    <div style="padding-top:8px;">
                        <div class="tx-grid tx-header">
                            <div>日期</div><div>動作</div><div class="num text-right">股數</div>
                            <div class="num text-right">股價</div><div class="num text-right">金額</div><div class="text-right">操作</div>
                        </div>
                        ${stTxs.map(tx => {
            const tag = types[tx.type] || ['未知', ''];
            const isDeleting = draftTxs.some(d => d.action === 'delete' && d.originalTx.id === tx.id);
            return `
                                <div class="tx-grid ${isDeleting ? 'tx-deleted' : ''}">
                                    <div class="num">${tx.date.substring(5)}</div>
                                    <div><span class="tx-tag ${tag[1]}">${tag[0]}</span></div>
                                    <div class="num text-right">${fmtMax3(tx.shares) || '-'}</div>
                                    <div class="num text-right">${tx.price ? fmtMax2(tx.price) : '-'}</div>
                                    <div class="num text-right">${fmtMax2(tx.cost)}</div>
                                    <div class="text-right">
                                        ${isDeleting ? '<span style="font-size:10px;">待刪</span>' : `
                                        <button class="tx-action-btn" onclick="editDBTx('${tx.id}')"><i class="fa-solid fa-pen"></i></button>
                                        <button class="tx-action-btn" onclick="deleteDBTx('${tx.id}')"><i class="fa-solid fa-trash"></i></button>`}
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            </div>`;
    });
    histDiv.innerHTML = histHtml;
}
