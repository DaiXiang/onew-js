function getFxQuoteCurrency(symbol) {
    if (symbol == null) {
        return null;
    }

    let text = `${symbol}`.trim().toUpperCase();
    if (text.length < 6) {
        return null;
    }

    let currency = text.slice(-3);
    return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function inferHkCurrency(symbol, name) {
    if (symbol == null || name == null) {
        return "HKD";
    }

    let code = `${symbol}`.trim();
    let normalizedName = `${name}`.trim().toUpperCase();

    if (normalizedName.endsWith("-U")) {
        return "USD";
    }
    if (code.startsWith("8") && normalizedName.endsWith("R")) {
        return "CNH";
    }
    return "HKD";
}

function inferCnStockCurrency(symbol2, symbol) {
    if (symbol2 == null || symbol == null) {
        return null;
    }

    let marketCode = `${symbol2}`.trim().toLowerCase();
    let code = `${symbol}`.trim();

    // B股：沪B(900xxx)=USD，深B(200xxx)=HKD
    if (marketCode.startsWith("sh") && code.startsWith("900")) {
        return "USD";
    }
    if (marketCode.startsWith("sz") && code.startsWith("200")) {
        return "HKD";
    }

    // 其余沪深股票默认按人民币
    if (marketCode.startsWith("sh") || marketCode.startsWith("sz")) {
        return "CNY";
    }
    return null;
}

function setCurrencyIfNeed(stock, currency) {
    if ($app.apiLevel >= 5 && currency != null) {
        stock.currency = currency;
    }
}

function search() {
    let keyword = $argument.get("keyword");
    let name = `suggestdata_${Date.now()}`;
    let baseUrl = "https://suggest3.sinajs.cn/suggest/key=" + encodeURIComponent(keyword) + "&name=" + name;

    let request = HTTPRequest.createWithBaseUrl(baseUrl)
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                $callback.onNext(null);
                $callback.onCompletion();
                return;
            }

            eval(resp.data);
            handleResult(eval(name))
        });
}

function handleResult(result) {
    if (result == undefined || result === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    var stocks = [];
    var cachedStock = {};
    var list = result.split(";");
    for (var index = 0; index < list.length; index++) {
        let item = list[index];
        let itemData = item.split(",");
        let type = itemData[1];
        let symbol = itemData[2];
        let symbol2 = itemData[3];
        let name = itemData[4];
        if (cachedStock[`${symbol2}_${name}`] == "1") { // 已处理
            continue;
        }
        cachedStock[`${symbol2}_${name}`] = "1"
        if (type == 41) { // 美股
            let stock = Stock.create(`${symbol.toUpperCase()}.US`, name);
            setCurrencyIfNeed(stock, "USD");
            stocks.push(stock);
        } else if (type == 31) { // 港股
            let stock = Stock.create(`${symbol}.HK`, name);
            setCurrencyIfNeed(stock, inferHkCurrency(symbol, name));
            stocks.push(stock);
        } else if (symbol2.startsWith("sh") || symbol2.startsWith("sz") || symbol2.startsWith("of")) { // 上证/深证/场外基金
            let stock = Stock.create(`${symbol}.${symbol2.slice(0, 2).toUpperCase()}`, name);
            setCurrencyIfNeed(stock, inferCnStockCurrency(symbol2, symbol));
            stocks.push(stock);
        } else if (type == 26) { // 封闭基金
            let stock = Stock.create(`${symbol}.OF`, name);
            stocks.push(stock);
        } else if (type == 71) { // 外汇
            let stock = Stock.create(`${symbol.toUpperCase()}.FX`, name);
            setCurrencyIfNeed(stock, getFxQuoteCurrency(symbol));
            stocks.push(stock);
        } else if (type == 86) { // CFD差价合约
            let stock = Stock.create(`${symbol.toUpperCase()}.CFD`, name);
            stocks.push(stock);
        } else if (type == 87) { // 期货
            let stock = Stock.create(`${symbol.toUpperCase()}.FUT`, name);
            stocks.push(stock);
        }
    }

    $callback.onNext(stocks);
    $callback.onCompletion();
}

function main() {
    search();
}
