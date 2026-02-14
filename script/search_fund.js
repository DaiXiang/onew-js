function search() {
    let keyword = $argument.get("keyword");
    let baseUrl = "https://apis.fundrich.com.tw/FRSDataCenter/Common/SearchBar";
    let body = {
        "data": {
            "kw": keyword
        }
    };
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .header("Content-Type", "application/json")
        .paramsBody(body)
        .post();
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                $callback.onNext(null);
                $callback.onCompletion();
                return;
            }

            handleResult(keyword, resp.data);
        });
}

function handleResult(symbol, result) {
    let data = JSON.parse(result);
    if (data.data == null || data.data.length != 1) {
        $callback.onNext(null);
        $callback.onCompletion();
        return
    }

    var stocks = [];
    let stock = Stock.create(`${symbol.toUpperCase()}.FUND`, data.data[0].name);
    stock.stockId = `frs${data.data[0].fundId}`;
    stocks.push(stock);

    $callback.onNext(stocks);
    $callback.onCompletion();
}

function main() {
    search();
}
