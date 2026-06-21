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
    marketTime: { tw: null, us: null },
    news: [],
    benchmarkData: null,
};

let twseDataMap = null;
let isHistoryLoaded = false;
let isDataInitialized = false;
let currentHeroMode = 'default';
let currentTab = 'dashboard';
let chartInst = { allocation: null, nw: null, stock: null, cash: null };
const changelog = [];
let draftTxs = [];

const fmtM = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtMax2 = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtMax3 = n => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
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

// 🌟 資訊頁面渲染核心 (含富台指現貨修正與盤中時間)
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
        'futw': 'FTCRTWNT.FGI'   // ✅ 改抓富台指底層現貨，解決 API 空白問題
    };

    const priceMap = await fetchHybridYahooQuotes(Object.values(symbols));

    for (const [id, sym] of Object.entries(symbols)) {
        const data = priceMap[sym];
        if (data) {
            const chg = data.price - data.prevClose;
            const pct = (chg / data.prevClose) * 100;

            const valEl = id === 'futw' ? $('info-futw-val') : $(`mkt-${id}`);
            const chgEl = id === 'futw' ? $('info-futw-chg') : $(`mkt-${id}-chg`);
            const timeEl = id === 'futw' ? $('info-futw-time') : $(`mkt-${id}-time`); // ✅ 支援富台指時間綁定

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

// 🌟 三大法人動態抓取核心 (含精確日期解析)
async function fetchInstitutionalData() {
    try {
        const apiUrl = `https://www.twse.com.tw/fund/BFI82U?response=json&type=day&_=${Date.now()}`;
        const proxyUrl = `${WORKER_URL}${encodeURIComponent(apiUrl)}`;

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('無法取得證交所資料');

        const json = await res.json();
        if (json.stat !== 'OK' || !json.data) throw new Error('三大法人資料格式異常');

        // ✅ 解析官方傳回的結算日期
        let reportDate = "最新交易日";
        if (json.date && json.date.length === 8) {
            reportDate = `${json.date.substring(0, 4)}/${json.date.substring(4, 6)}/${json.date.substring(6, 8)}`;
        }

        const parseToYi = (str) => {
            const num = parseInt(str.replace(/,/g, ''), 10);
            return num / 100000000;
        };

        let dealer = 0, trust = 0, foreign = 0;

        json.data.forEach(row => {
            const name = row[0];
            const netVal = parseToYi(row[3]);

            if (name.includes('自營商(自行買賣)') || name.includes('自營商(避險)')) {
                dealer += netVal;
            } else if (name.includes('投信')) {
                trust = netVal;
            } else if (name.includes('外資及陸資') || name.includes('外資自營商')) {
                foreign += netVal;
            }
        });

        const updateChipCard = (elementId, dateId, value) => {
            const el = $(elementId);
            const dateEl = $(dateId);
            if (!el) return;

            const displayStr = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
            el.textContent = displayStr;
            el.className = 'market-val num ' + (value > 0 ? 'color-up' : (value < 0 ? 'color-down' : ''));

            if (dateEl) {
                dateEl.textContent = reportDate;
            }
        };

        updateChipCard('info-foreign-val', 'info-foreign-date', foreign);
        updateChipCard('info-trust-val', 'info-trust-date', trust);
        updateChipCard('info-dealer-val', 'info-dealer-date', dealer);

    } catch (error) {
        console.error('抓取籌碼資料失敗:', error);
        ['info-foreign-val', 'info-trust-val', 'info-dealer-val'].forEach(id => {
            if ($(id)) $(id).textContent = '暫無資料';
        });
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
    $('exchange-rate-display').innerText = `匯率 USD/TWD = ${appData.settings.usdToTwd.toFixed(2)}`;

    const bindPrice = (stock, isUS) => {
        const sym = isUS ? stock.symbol : `${stock.symbol}.TW`;
        const q = yfData[sym];

        if (!isUS && twseDataMap?.[stock.symbol]) {
            stock.currentPrice = twseDataMap[stock.symbol];
            stock.isError = false;
            if (q?.prevClose) {
                stock.prevClose = q.prevClose;
            }
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
                <span class="item-sub reduced-font">
                    <span class="${clr(profit)}">${profitStr}</span>
                </span>
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
    if (currentTab === 'dashboard') {
        renderAllocationChart();
        renderDistributionCharts();
    }

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
    const isSt = (v === 'history' || v === 'edit' || v === 'transactions');
    const isTracking = (v === 'tracking');
    const isHistory = (v === 'history');

    $('hero-main-title').innerText = isSt ? '股票資產總淨值' : '總資產淨值';

    const mainAmount = isSt ? appData.totals.stockNet : appData.totals.grandNet;
    animateVal("grand-total", mainAmount);

    const subInfo = document.querySelector('.hero-sub-info');
    if (!subInfo) return;

    if (isTracking) {
        subInfo.innerHTML = `
            <div><span style="color: #C5A059; font-weight: 600;">台股資產</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.totals.twNet)}</strong></div>
            <div><span style="color: #D96B6B; font-weight: 600;">美股資產</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.totals.usNet)}</strong></div>
            <div><span style="color: #7aa0dd; font-weight: 600;">現金部位</span><strong class="num" style="color: var(--text-navy);">${fmtM(appData.cash)}</strong></div>
        `;
    } else if (isHistory) {
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

    ['dashboard', 'tracking', 'history', 'transactions', 'info', 'news'].forEach(t => {
        const contentDiv = $(t + '-content');
        if (contentDiv) {
            contentDiv.classList[target === t ? 'remove' : 'add']('hide');
        }
    });

    const heroSection = document.querySelector('.hero-section');
    if (heroSection) {
        if (target === 'info' || target === 'news') {
            heroSection.classList.add('hide');
        } else {
            heroSection.classList.remove('hide');
            updateHeroBanner(target);
        }
    }

    if (target === 'dashboard') renderAllocationChart();
    else if (target === 'history' && !isHistoryLoaded && (appData.twStocks.length > 0 || appData.usStocks.length > 0)) loadHistoryData();
    else if (target === 'tracking') renderTrackingChart();
    else if (target === 'transactions') renderTxView();
    else if (target === 'info') renderInfoView();
    else if (target === 'news') {
        if (appData.news.length === 0) fetchNewsData();
        else renderNewsView();
    }
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

// 🌟 移除原本的右上角定位器，改用「純 HTML 外部提示框」魔法
const getChartOpt = () => ({
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { bottom: 10 } },

    // 依然保持游標靠近就吸附的磁吸效果
    interaction: {
        mode: 'index',
        intersect: false
    },

    plugins: {
        legend: { display: false },
        tooltip: {
            enabled: false, // 🌟 關鍵 1：關閉原本內建在畫布裡面的提示框
            position: 'nearest',
            external: function (context) {
                // 🌟 關鍵 2：動態生成一個不受畫布限制的 HTML 提示區塊
                let tooltipEl = document.getElementById('custom-chart-tooltip');

                // 如果還沒有這個區塊，就在網頁 body 產生一個
                if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'custom-chart-tooltip';
                    tooltipEl.style.background = 'rgba(26, 36, 54, 0.9)';
                    tooltipEl.style.borderRadius = '8px';
                    tooltipEl.style.color = 'white';
                    tooltipEl.style.opacity = 0;
                    tooltipEl.style.pointerEvents = 'none';
                    tooltipEl.style.position = 'absolute';
                    tooltipEl.style.transform = 'translate(-100%, 0)'; // 強制往左邊生長，絕對不會蓋到右邊的按鈕
                    tooltipEl.style.transition = 'all .15s ease'; // 加上滑順的跟隨動畫
                    tooltipEl.style.zIndex = 9999;
                    tooltipEl.style.padding = '12px';
                    tooltipEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    tooltipEl.style.fontFamily = 'Inter, sans-serif';
                    document.body.appendChild(tooltipEl);
                }

                const tooltipModel = context.tooltip;

                // 如果滑鼠離開了圖表，就把這個 HTML 區塊隱藏
                if (tooltipModel.opacity === 0) {
                    tooltipEl.style.opacity = 0;
                    return;
                }

                // 組合裡面的日期、顏色標籤、線條名稱與金額數字
                if (tooltipModel.body) {
                    const titleLines = tooltipModel.title || [];

                    // 標題區塊：加上底線分隔，視覺更俐落
                    let innerHtml = `<div style="font-weight:bold; margin-bottom:12px; font-size:14px; color:#8A94A6; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">${titleLines[0]}</div>`;

                    // 🌟 啟動 CSS Grid 網格：設定為 3 欄並排，並拉開直向與橫向的間距
                    innerHtml += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px;">`;

                    tooltipModel.dataPoints.forEach(function (dp, i) {
                        const colors = tooltipModel.labelColors[i];
                        const borderColor = colors.borderColor;
                        const val = Math.round(dp.parsed.y).toLocaleString();
                        const label = dp.dataset.label;

                        // 🌟 內部排版優化：將「標籤」與「金額」改為上下兩行，適合多欄位並排閱讀
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

                    innerHtml += `</div>`; // 關閉 Grid 容器
                    tooltipEl.innerHTML = innerHtml;
                }

                // 🌟 關鍵 3：將提示框固定在圖表中央
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
            ticks: { font: { size: 10, family: 'Inter' }, autoSkip: false, maxRotation: 45, minRotation: 45 },
            grid: { display: false }
        }
    }
});

function renderDistributionCharts() {
    // --- 共用：取得單一股票的目前淨值 ---
    const getTwNetValue = (symbol) => {
        const stock = appData.twStocks.find(s => s.symbol === symbol);
        if (stock && !stock.isError && stock.currentPrice) {
            return stock.currentPrice * stock.shares;
        }
        return 0;
    };
    const getUsNetValue = (symbol) => {
        const stock = appData.usStocks.find(s => s.symbol === symbol);
        if (stock && !stock.isError && stock.currentPrice) {
            return stock.currentPrice * stock.shares * appData.settings.usdToTwd;
        }
        return 0;
    };

    // --- 共用：把 {label,value,color,pinned?}[] 畫成堆疊長條圖 + 圖例，並塞進指定容器 ---
    // pinned: true 的項目固定排在最後（不參與金額排序），目前用於現金資產
    // fixedOrder: true 時，整組資料完全依原始陣列順序顯示，不做任何金額排序
    const renderStackedBar = (container, data, emptyText, fixedOrder = false) => {
        const total = data.reduce((sum, item) => sum + item.value, 0);

        if (total <= 0) {
            container.innerHTML = `<div class="empty-state" style="padding: 10px 0;">${emptyText}</div>`;
            return;
        }

        let sorted;
        if (fixedOrder) {
            sorted = data;
        } else {
            const normal = data.filter(item => !item.pinned).sort((a, b) => b.value - a.value);
            const pinned = data.filter(item => item.pinned);
            sorted = [...normal, ...pinned];
        }

        const segmentsHtml = sorted.map(item => {
            const percentage = (item.value / total) * 100;
            return `<div class="stacked-bar-segment" style="width: ${percentage.toFixed(2)}%; background-color: ${item.color};" title="${item.label}: ${percentage.toFixed(1)}%"></div>`;
        }).join('');

        const legendHtml = sorted.map(item => {
            const percentage = (item.value / total) * 100;
            return `
                <div class="stacked-bar-legend-item">
                    <span class="legend-color-box" style="background-color: ${item.color};"></span>
                    <span class="legend-label">${item.label}</span>
                    <span class="legend-value">${percentage.toFixed(1)}%</span>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="stacked-bar-wrapper">
                ${segmentsHtml}
            </div>
            <div class="stacked-bar-legend">
                ${legendHtml}
            </div>
        `;
    };

    // --- 1. 台股組合持股分佈 ---
    const twDistContainer = $('tw-dist-bars');
    if (twDistContainer) {
        const tsmcValue = getTwNetValue('2330') + (getTwNetValue('006208') * 0.6) + (getTwNetValue('00881') * 0.4);
        const otherTechValue = (getTwNetValue('00881') * 0.6) + (getTwNetValue('006208') * 0.3) + (getTwNetValue('00878') * 0.6);
        const nonTechValue = getTwNetValue('2886') + getTwNetValue('2881') + (getTwNetValue('006208') * 0.1) + (getTwNetValue('00878') * 0.4);

        // 固定順序：TSMC概念 → 其他科技電子 → 傳產金融（不依金額排序）
        const twData = [
            { label: 'TSMC 概念', value: tsmcValue, color: 'rgba(44, 58, 80, 0.7)' },
            { label: '其他科技電子', value: otherTechValue, color: '#5B8DB8' },
            { label: '傳產金融', value: nonTechValue, color: '#549B7B' }
        ];

        renderStackedBar(twDistContainer, twData, '無台股資料可供分析', true);
    }
    // --- 2. 美股組合持股分佈 ---
    const usDistContainer = $('us-dist-bars');
    if (usDistContainer) {
        const techSymbols = ['AAPL', 'GOOG', 'TSLA', 'QQQ', 'SMH', 'SPCX'];
        const usTechValue = techSymbols.reduce((sum, sym) => sum + getUsNetValue(sym), 0)
            + (getUsNetValue('VTI') * 0.35);

        const nonTechSymbols = ['TLT', 'LQD'];
        const usNonTechValue = nonTechSymbols.reduce((sum, sym) => sum + getUsNetValue(sym), 0)
            + (getUsNetValue('VTI') * 0.65);

        const usData = [
            { label: '科技電子類股', value: usTechValue, color: '#5B8DB8' },
            { label: '非科技類股', value: usNonTechValue, color: '#549B7B' }
        ];

        renderStackedBar(usDistContainer, usData, '無美股資料可供分析');
    }

    // --- 3. 總資產大類配比 ---
    const totalDistContainer = $('total-dist-bars');
    if (totalDistContainer) {
        const twTechValue = getTwNetValue('2330') + (getTwNetValue('006208') * 0.6) + (getTwNetValue('00881') * 0.4)
            + (getTwNetValue('00881') * 0.6) + (getTwNetValue('006208') * 0.3) + (getTwNetValue('00878') * 0.6);
        const twNonTechValue = getTwNetValue('2886') + getTwNetValue('2881') + (getTwNetValue('006208') * 0.1) + (getTwNetValue('00878') * 0.4);

        const usTechSymbols = ['AAPL', 'GOOG', 'TSLA', 'QQQ', 'SMH', 'SPCX'];
        const usTechValue = usTechSymbols.reduce((sum, sym) => sum + getUsNetValue(sym), 0)
            + (getUsNetValue('VTI') * 0.4);
        const usNonTechSymbols = ['TLT', 'LQD'];
        const usNonTechValue = usNonTechSymbols.reduce((sum, sym) => sum + getUsNetValue(sym), 0)
            + (getUsNetValue('VTI') * 0.6);

        const cashValue = (appData.cash && !isNaN(appData.cash)) ? appData.cash : 0;

        const totalData = [
            { label: '台美科技電子股', value: twTechValue + usTechValue, color: '#5B8DB8' },
            { label: '台美非科技電子股', value: twNonTechValue + usNonTechValue, color: '#549B7B' },
            { label: '現金資產', value: cashValue, color: '#C5A059', pinned: true }
        ];

        renderStackedBar(totalDistContainer, totalData, '無資料可供分析');
    }
}

function drawLineChart(chartInstance, ctxId, labels, datasetsConfig) {
    if (chartInstance) chartInstance.destroy();
    const ctx = $(ctxId);
    if (!ctx) return null;

    const options = getChartOpt();

    options.scales = options.scales || {};
    options.scales.x = options.scales.x || { ticks: {}, grid: {} };

    options.scales.x.ticks.callback = function (value, index, values) {
        let labelStr = this.getLabelForValue(value);
        if (labelStr && labelStr.match(/(?:-|\/)0?1$/)) return labelStr;
        return null;
    };
    options.scales.x.ticks.autoSkip = false;
    options.scales.x.ticks.maxRotation = 0;
    options.scales.x.ticks.minRotation = 0;

    options.scales.x.grid.display = true;
    options.scales.x.grid.drawTicks = true;
    options.scales.x.grid.tickLength = 6;
    options.scales.x.grid.tickWidth = 2;
    options.scales.x.grid.drawOnChartArea = true;
    options.scales.x.grid.color = function (context) {
        if (context.tick && context.tick.label) return 'rgba(150, 150, 150, 0.2)';
        return 'rgba(0, 0, 0, 0)';
    };

    if (datasetsConfig.length > 1) {
        options.plugins.legend = {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
                boxWidth: 5,
                boxHeight: 5,
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
        borderWidth: ds.isBenchmark ? 1 : 2,
        pointBackgroundColor: '#cddef404',
        pointBorderColor: ds.color,
        pointRadius: ds.isBenchmark ? 0 : 0,
        fill: ds.bg !== 'transparent',
        tension: 0,
        yAxisID: ds.yAxisID || 'y'
    }));

    datasetsConfig.forEach(ds => {
        if (ds.yAxisID && ds.yAxisID !== 'y') {
            options.scales[ds.yAxisID] = { type: 'linear', display: false };
        }
    });

    return new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: chartDatasets },
        options: options
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
        { label: '現金', data: cashData, color: '#3A4A63', bg: 'rgba(58,74,99,0.1)' }
    ]);

    const bench = await fetchBenchmarkData();
    if (bench && bench['006208'].length > 0 && bench['SPY'].length > 0) {

        const matchPrice = (targetDateStr, benchHistory) => {
            const targetTime = new Date(targetDateStr).getTime();
            let closest = benchHistory[0]?.price || 0;
            for (let b of benchHistory) {
                if (b.time <= targetTime + 86400000) closest = b.price;
                else break;
            }
            return closest;
        };

        const rawData6208 = hist.map(i => matchPrice(i.date, bench['006208']));
        const rawDataSPY = hist.map(i => matchPrice(i.date, bench['SPY']));

        let baseIndex = lbls.findIndex(l => l.includes('-03-17'));
        if (baseIndex === -1) baseIndex = 0;

        const nwTargetAmount = 4756878;
        const stockTargetAmount = 2650517;

        const normalize = (rawData, targetAmt) => {
            const basePrice = rawData[baseIndex] || rawData[0];
            if (!basePrice) return rawData;
            return rawData.map(price => (price / basePrice) * targetAmt);
        };

        nwDatasets.push({
            label: '006208 (對比總資產)',
            data: normalize(rawData6208, nwTargetAmount),
            color: 'rgba(243, 156, 18, 0.7)',
            bg: 'transparent',
            yAxisID: 'y',
            isBenchmark: true
        });
        nwDatasets.push({
            label: 'SPY',
            data: normalize(rawDataSPY, nwTargetAmount),
            color: 'rgba(155, 89, 182, 0.7)',
            bg: 'transparent',
            yAxisID: 'y',
            isBenchmark: true
        });

        stockDatasets.push({
            label: '006208',
            data: normalize(rawData6208, stockTargetAmount),
            color: 'rgba(243, 156, 18, 0.7)',
            bg: 'transparent',
            yAxisID: 'y',
            isBenchmark: true
        });
        stockDatasets.push({
            label: 'SPY',
            data: normalize(rawDataSPY, stockTargetAmount),
            color: 'rgba(155, 89, 182, 0.7)',
            bg: 'transparent',
            yAxisID: 'y',
            isBenchmark: true
        });

        chartInst.nw = drawLineChart(chartInst.nw, 'netWorthChart', lbls, nwDatasets);
        chartInst.stock = drawLineChart(chartInst.stock, 'stockNetChart', lbls, stockDatasets);
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

async function saveCash() {
    const val = parseFloat($('edit-cash-input').value);
    if (!isNaN(val)) {
        addChangelog('cash', 'TWD', `${appData.cash.toLocaleString()} → ${val.toLocaleString()}`);
        appData.cash = val;
        renderApp();
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
                    const exRate = s.m === 'US' ? appData.settings.usdToTwd : 1;
                    const totalCost = s.costPrice * s.shares;
                    const totalNet = s.currentPrice * s.shares;
                    const totalProfit = (totalNet - totalCost) * exRate;
                    const totalProfitPct = totalCost > 0 ? ((totalNet - totalCost) / totalCost) * 100 : 0;

                    appData.history.push({ market: s.m, symbol: s.symbol, d1: d1r, d5: hist5.pct, d22: hist22.pct, pD1: pD1, pM1: hist22.profit, totalProfit: totalProfit, totalProfitPct: totalProfitPct });
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
    } else {
        d.sort((a, b) => currentHeroMode === 'd1Pct' ? b.d1 - a.d1 : (currentHeroMode === 'd1Profit' ? b.pD1 - a.pD1 : b.pM1 - a.pM1));
    }

    const fPct = v => `<span class="${clr(v)}">${fmtP(v)}</span>`;
    const fPro = v => `<span class="${clr(v)}">${v > 0 ? '+' : ''}${fmtM(v)}</span>`;

    const sumD1 = d.reduce((a, b) => a + (b.pD1 || 0), 0);
    const sumTotalProfit = d.reduce((a, b) => a + (b.totalProfit || 0), 0);
    const gridCols = "1fr 1.4fr 1.1fr 1.4fr 1.1fr 1.1fr 1.1fr";

    let h = `
                <div class="history-grid" style="color:var(--text-muted); border-bottom:2px solid var(--border-light); padding-bottom:8px; grid-template-columns: ${gridCols};">
                    <div class="col-name">代號</div>
                    <div class="text-right">當日損益</div>
                    <div>當日損益(%)</div>
                    <div class="text-right">累計損益</div>
                    <div>累計損益(%)</div>
                    <div>5日(%)</div>
                    <div>22日(%)</div>
                </div>
                <div class="history-grid" style="background:rgba(197,160,89,0.08); border-radius:6px; padding:10px 8px; margin:8px 0; border:none; grid-template-columns: ${gridCols};">
                    <div class="col-name" style="color:var(--accent-gold);font-size:13px;">組合總計</div>
                    <div class="num text-right" style="font-weight:700;font-size:13px">${fPro(sumD1)}</div>
                    <div>-</div>
                    <div class="num text-right" style="font-weight:700;font-size:13px">${fPro(sumTotalProfit)}</div>
                    <div>-</div>
                    <div>-</div>
                    <div>-</div>
                </div>
            `;

    d.forEach(i => {
        h += `
                    <div class="history-grid" style="grid-template-columns: ${gridCols};">
                        <div class="col-name num">${i.symbol}</div>
                        <div class="num text-right">${fPro(i.pD1)}</div>
                        <div class="num">${fPct(i.d1)}</div>
                        <div class="num text-right">${fPro(i.totalProfit)}</div>
                        <div class="num">${fPct(i.totalProfitPct)}</div>
                        <div class="num">${fPct(i.d5)}</div>
                        <div class="num">${fPct(i.d22)}</div>
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

window.onload = () => refreshData(false);

function updateCostPlaceholder() {
    const symbolSelect = $('tx-symbol');
    const costInput = $('tx-cost');
    const selectedVal = symbolSelect.value;

    if (selectedVal === 'NEW_ACTION') {
        const market = $('add-market').value;
        costInput.placeholder = (market === 'US') ? "請輸入美金總額 (USD)" : "請輸入台幣總額 (TWD)";
    }
    else if (selectedVal === '') {
        costInput.placeholder = "請選擇標的";
    }
    else {
        const isUS = appData.usStocks.some(s => s.symbol === selectedVal);
        costInput.placeholder = isUS ? "請輸入美金總額 (USD)" : "請輸入台幣總額 (TWD)";
    }
}

function toggleNewStockFields() {
    const symbolSelect = $('tx-symbol');
    const extraFields = $('new-stock-extra-fields');

    if (symbolSelect.value === 'NEW_ACTION') {
        extraFields.style.display = 'block';
    } else {
        extraFields.style.display = 'none';
    }
    updateCostPlaceholder();
}

async function handleStageTx() {
    const symbolSelect = $('tx-symbol');
    let targetSymbol = symbolSelect.value;

    if (targetSymbol === 'NEW_ACTION') {
        const market = $('add-market').value;
        const newSym = $('add-symbol').value.trim().toUpperCase();

        if (!newSym) return alert("請輸入新標的代號！");

        const exists = [...appData.twStocks, ...appData.usStocks].some(s => s.symbol === newSym);
        if (exists) {
            alert("此標的已在庫存中，請直接從下拉選單選擇。");
            symbolSelect.value = newSym;
            toggleNewStockFields();
            return;
        }

        const obj = {
            symbol: market === 'TW' ? newSym.replace(/\.TW$|\.TWO$/i, '') : newSym,
            shares: 0,
            costPrice: 0,
            currentPrice: null,
            prevClose: null,
            isError: true
        };

        appData[market === 'TW' ? 'twStocks' : 'usStocks'].push(obj);

        addChangelog('add', obj.symbol, `建立新標的 (${market})`);

        renderTxView();

        $('tx-symbol').value = obj.symbol;
        toggleNewStockFields();

        fetchPricesAndRender();

        targetSymbol = obj.symbol;
    }

    stageTx();
}

function renderTxView() {
    const twStocks = appData.twStocks || [];
    const usStocks = appData.usStocks || [];
    const sel = $('tx-symbol');

    const currentVal = sel.value;

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

    if (currentVal) sel.value = currentVal;

    if (!$('tx-date').value) $('tx-date').value = new Date().toISOString().split('T')[0];

    renderDraftTxs();

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

        const isTW = twStocks.some(tw => tw.symbol === s.symbol);
        const marketLabel = isTW
            ? `<span style="color: #C5A059; margin-right: 8px; font-size: 0.65em;vertical-align: middle">台股</span>`
            : `<span style="color: #D96B6B; margin-right: 8px; font-size: 0.65em;vertical-align: middle">美股</span>`;

        histHtml += `
            <div class="card tx-card" id="tx-card-${s.symbol}">
                <div class="card-header tx-stock-header cursor-default mb-0" onclick="toggleCard('tx-card-${s.symbol}')">
                    <div>
                        <h2 class="card-title">${marketLabel}${s.symbol}</h2>
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

async function fetchNewsData() {
    const listDiv = document.querySelector('#news-content .news-list');
    if (listDiv) listDiv.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> 正在從邊緣節點讀取新聞...</div>';

    try {
        const res = await fetch(`${DB_URL}?type=news`, {
            headers: { 'X-Master-Key': SECRET_KEY }
        });

        if (!res.ok) throw new Error('伺服器回應錯誤');

        const data = await res.json();

        let allNews = [];

        if (data && data.articles) {
            if (data.articles.fx) {
                allNews = allNews.concat(data.articles.fx.map(item => ({ ...item, category: 'CURRENCY' })));
            }
            if (data.articles.tw) {
                allNews = allNews.concat(data.articles.tw.map(item => ({ ...item, category: 'TW STOCK' })));
            }
            if (data.articles.us) {
                allNews = allNews.concat(data.articles.us.map(item => ({ ...item, category: 'US STOCK' })));
            }
        } else if (Array.isArray(data)) {
            allNews = data;
        }

        const strictTimeLimit = new Date(Date.now() - 48 * 60 * 60 * 1000);

        allNews = allNews
            .filter(item => new Date(item.pubDate) >= strictTimeLimit)
            .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        appData.news = allNews;
        appData.newsUpdatedTime = data.updatedTime || null;

        renderNewsView();
    } catch (e) {
        console.error("抓取新聞失敗:", e);
        if (listDiv) listDiv.innerHTML = '<div class="empty-state color-down">讀取新聞失敗，請檢查 API 或是 Worker 設定。</div>';
    }
}

function renderNewsView() {
    const listDiv = document.querySelector('#news-content .news-list');
    if (!listDiv) return;

    if (!appData.news || appData.news.length === 0) {
        listDiv.innerHTML = '<div class="empty-state">目前無新聞資料</div>';
        return;
    }

    const subtitle = document.querySelector('.news-hero-subtitle');
    if (subtitle) {
        let timeStr = appData.newsUpdatedTime || appData.news[0].pubDate;
        let displayTime = '剛剛';

        if (timeStr) {
            try {
                const d = new Date(timeStr);
                displayTime = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            } catch (e) {
                displayTime = timeStr;
            }
        }
        subtitle.innerHTML = `最後更新：${displayTime}<br>目前使用關鍵字：台股、美股、美元匯率、國際局勢`;
    }

    const cardsHtml = appData.news.map(item => {
        const tag = item.category || 'BUSINESS';
        const itemDate = item.pubDate ? new Date(item.pubDate).toLocaleString('zh-TW', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

        return `
        <div class="news-card">
            <h2 class="news-card-title" style="font-size: 16px; line-height: 1.4; letter-spacing: 1px;">${item.title}</h2>
            <span class="news-card-tag">${tag}</span>
            <div class="news-card-footer" style="margin-top: 15px;">
                <span class="news-card-date">${itemDate}</span>
                <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="news-card-link">繼續閱讀..</a>
            </div>
        </div>
        `;
    }).join('');

    listDiv.innerHTML = cardsHtml;
}