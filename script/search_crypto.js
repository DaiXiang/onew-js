function setCurrencyIfNeed(stock, currency) {
    if ($app.apiLevel >= 5 && currency != null && currency !== "") {
        stock.currency = currency;
    }
}

function stripHtmlTags(text) {
    if (text == null) {
        return "";
    }
    return `${text}`.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function normalizeProviderSymbol(rawSymbol) {
    return stripHtmlTags(rawSymbol).toUpperCase();
}

function toAppSymbol(providerSymbol) {
    if (providerSymbol == null || providerSymbol === "") {
        return null;
    }
    if (!providerSymbol.endsWith(".V")) {
        return null;
    }
    return `${providerSymbol.substring(0, providerSymbol.length - 2)}.CC`;
}

function inferCurrency(providerSymbol, name) {
    let normalizedName = stripHtmlTags(name).toUpperCase();
    let matchByName = normalizedName.match(/([A-Z]{3})$/);
    if (matchByName != null && matchByName[1] != null) {
        return matchByName[1];
    }

    let normalizedSymbol = normalizeProviderSymbol(providerSymbol);
    if (normalizedSymbol.endsWith(".V")) {
        let base = normalizedSymbol.substring(0, normalizedSymbol.length - 2);
        if (base.length >= 6) {
            let quote = base.substring(base.length - 3);
            if (/^[A-Z]{3}$/.test(quote)) {
                return quote;
            }
        }
    }

    return "USD";
}

function extractPayload(data) {
    if (data == null || data === "") {
        return null;
    }

    let match = `${data}`.match(/window\.cmp_r\('([\s\S]*)'\);?/);
    if (match == null || match[1] == null || match[1] === "") {
        return null;
    }

    return `${match[1]}`.replace(/\\'/g, "'");
}

function search() {
    let keyword = stripHtmlTags($argument.get("keyword"));
    if (keyword === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let baseUrl = `https://stooq.com/cmp/?${Date.now()}&q=${encodeURIComponent(keyword)}`;
    let request = HTTPRequest.createWithBaseUrl(baseUrl);

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                $callback.onNext(null);
                $callback.onCompletion();
                return;
            }

            handleResult(resp.data);
        });
}

function handleResult(result) {
    let payload = extractPayload(result);
    if (payload == null || payload === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let dataArray = payload.split("|");
    let stocks = [];
    let cached = {};

    for (const dataItem of dataArray) {
        if (dataItem == null || dataItem.trim() === "") {
            continue;
        }

        let fields = dataItem.split("~");
        if (fields.length < 4) {
            continue;
        }

        let type = stripHtmlTags(fields[2]).toLowerCase();
        if (type !== "cryptocurrency") {
            continue;
        }

        let providerSymbol = normalizeProviderSymbol(fields[0]);
        let appSymbol = toAppSymbol(providerSymbol);
        if (appSymbol == null || appSymbol === "") {
            continue;
        }

        let name = stripHtmlTags(fields[1]);
        if (name === "") {
            name = providerSymbol;
        }

        let dedupeKey = `${appSymbol}#${name}`;
        if (cached[dedupeKey] === "1") {
            continue;
        }
        cached[dedupeKey] = "1";

        let stock = Stock.create(appSymbol, name);
        setCurrencyIfNeed(stock, inferCurrency(providerSymbol, name));
        stocks.push(stock);
    }

    $callback.onNext(stocks.length === 0 ? null : stocks);
    $callback.onCompletion();
}

function main() {
    search();
}
