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
            stocks.push(stock);
        } else if (type == 31) { // 港股
            let stock = Stock.create(`${symbol}.HK`, name);
            stocks.push(stock);
        } else if (symbol2.startsWith("sh") || symbol2.startsWith("sz") || symbol2.startsWith("of")) { // 上证/深证/场外基金
            let stock = Stock.create(`${symbol}.${symbol2.slice(0, 2).toUpperCase()}`, name);
            stocks.push(stock);
        } else if (type == 26) { // 封闭基金
            let stock = Stock.create(`${symbol}.OF`, name);
            stocks.push(stock);
        }
    }
    
    $callback.onNext(stocks);
    $callback.onCompletion();
}

function main() {
    search();
}
