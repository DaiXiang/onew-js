function setCurrencyIfNeed(stock, currency) {
    if ($app.apiLevel >= 5 && currency != null && currency !== "") {
        stock.currency = currency;
    }
}

function normalizeKeyword(keyword) {
    if (keyword == null) {
        return "";
    }
    return `${keyword}`.trim();
}

function getFieldValue(fields, key) {
    if (fields == null || fields[key] == null) {
        return null;
    }

    let field = fields[key];
    if (field == null) {
        return null;
    }
    if (typeof field === "string") {
        let value = `${field}`.trim();
        return value === "" ? null : value;
    }

    let value = field.value;
    if (value == null || value === "") {
        return null;
    }
    return `${value}`.trim();
}

function buildSearchQuery(keyword) {
    let safeKeyword = `${keyword}`.replace(/"/g, '\\"');
    return `((isin ~= "${safeKeyword}" OR ticker ~= "${safeKeyword}" OR name ~= "${safeKeyword}" OR companyName ~= "${safeKeyword}" OR isin ~= "${safeKeyword}") AND (((investmentType = "EQ") OR (investmentType = "FC") AND (countriesOfSale = "HKG") OR (investmentType = "FE") AND (exchangeCountry in ("HKG","MYS","SGP","THA","TWN")) OR (investmentType = "FO") AND (countriesOfSale = "HKG") OR (investmentType = "XI"))))`;
}

function search() {
    let keyword = normalizeKeyword($argument.get("keyword"));
    if (keyword === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let baseUrl = "https://global.morningstar.com/api/v1/en-ea/search/securities";
    let request = HTTPRequest.createWithBaseUrl(baseUrl)
        .params({
            "fields": "baseCurrency,dgsCode,exchange,exchangeCountry,fundServCodes,isin,itaCode,marketCap,name,shortName,thailandFundCode,ticker",
            "limit": "20",
            "page": "1",
            "query": buildSearchQuery(keyword),
            "sort": "_score"
        })
        .get();

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
    try {
        let data = JSON.parse(result);
        if (data == null || !Array.isArray(data.results) || data.results.length === 0) {
            $callback.onNext(null);
            $callback.onCompletion();
            return;
        }

        var stocks = [];
        var cachedStock = {};

        for (const item of data.results) {
            let meta = item.meta || {};
            if (meta.universe !== "FO") {
                continue;
            }

            let securityID = meta.securityID == null ? "" : `${meta.securityID}`.trim();
            if (securityID === "") {
                continue;
            }

            let isin = getFieldValue(item.fields, "isin");
            if (isin == null || isin === "") {
                continue;
            }

            let symbol = `${isin.toUpperCase()}.FUND`;
            let name = getFieldValue(item.fields, "shortName") || getFieldValue(item.fields, "name");
            if (name == null || name === "") {
                continue;
            }

            let dedupeKey = `${symbol}#${securityID}`;
            if (cachedStock[dedupeKey] === "1") {
                continue;
            }
            cachedStock[dedupeKey] = "1";

            let stock = Stock.create(symbol, name);
            stock.stockId = `msf${securityID}`;
            setCurrencyIfNeed(stock, getFieldValue(item.fields, "baseCurrency"));
            stocks.push(stock);
        }

        $callback.onNext(stocks.length === 0 ? null : stocks);
        $callback.onCompletion();
    } catch (e) {
        $callback.onNext(null);
        $callback.onCompletion();
    }
}

function main() {
    search();
}
