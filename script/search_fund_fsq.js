function setCurrencyIfNeed(stock, currency) {
    if ($app.apiLevel >= 5 && currency != null && currency !== "") {
        stock.currency = currency;
    }
}

function decodeHtmlEntities(text) {
    if (text == null) {
        return "";
    }

    return `${text}`
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, function(_, code) {
            let value = parseInt(code, 10);
            return Number.isNaN(value) ? _ : String.fromCharCode(value);
        })
        .replace(/&#x([0-9a-f]+);/gi, function(_, code) {
            let value = parseInt(code, 16);
            return Number.isNaN(value) ? _ : String.fromCharCode(value);
        });
}

function normalizeText(text) {
    return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function stripHtmlTags(text) {
    if (text == null) {
        return "";
    }

    return normalizeText(`${text}`
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, " "));
}

function preprocessHtml(html) {
    if (html == null) {
        return "";
    }

    return `${html}`
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<table class="mention"[\s\S]*?<\/table>/gi, " ");
}

function looksLikeISIN(text) {
    let normalized = normalizeText(text).toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(normalized);
}

function extractCurrency(text) {
    let matches = normalizeText(text).toUpperCase().match(/\b[A-Z]{3}\b/g);
    if (matches == null || matches.length === 0) {
        return null;
    }
    return matches[matches.length - 1];
}

function buildInstrumentCacheKey(isin) {
    return `fsq_instr_${isin}`;
}

function saveInstrumentCacheIfNeed(isin, instrumentId) {
    if (isin == null || isin === "" || instrumentId == null || instrumentId === "") {
        return;
    }
    $cache.savePersistent(buildInstrumentCacheKey(isin), `${instrumentId}`);
}

function createStock(isin, instrumentId, name, currency) {
    let normalizedISIN = normalizeText(isin).toUpperCase();
    let normalizedName = normalizeText(name);
    if (!looksLikeISIN(normalizedISIN) || instrumentId == null || instrumentId === "" || normalizedName === "") {
        return null;
    }

    let stock = Stock.create(`${normalizedISIN}.FUND`, normalizedName);
    stock.stockId = `fsq${instrumentId}`;
    setCurrencyIfNeed(stock, currency);
    saveInstrumentCacheIfNeed(normalizedISIN, instrumentId);
    return stock;
}

function parseSummaryPage(html) {
    let cleaned = preprocessHtml(html);
    let instrumentMatch = cleaned.match(/\/security\/(?:summary|price)\?idInstr=(\d+)/i);
    if (instrumentMatch == null || instrumentMatch[1] == null) {
        return [];
    }

    let titleMatch = cleaned.match(/<span style="font-weight:\s*bold;">([\s\S]*?)<\/span>\s*&nbsp;&nbsp;([\s\S]*?)&nbsp;&nbsp;<\/td>/i);
    let isin = titleMatch != null ? normalizeText(titleMatch[1]).toUpperCase() : null;
    if (!looksLikeISIN(isin)) {
        let fallbackISINMatch = cleaned.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/);
        isin = fallbackISINMatch == null ? null : `${fallbackISINMatch[0]}`.toUpperCase();
    }

    let name = titleMatch != null ? stripHtmlTags(titleMatch[2]) : "";
    let priceMatch = cleaned.match(/<span class="surligneorange">([\s\S]*?)<\/span>/i);
    let currency = priceMatch == null ? null : extractCurrency(priceMatch[1]);
    let stock = createStock(isin, instrumentMatch[1], name, currency);
    return stock == null ? [] : [stock];
}

function parseSearchRows(html) {
    let cleaned = preprocessHtml(html);
    let stocks = [];
    let cached = {};
    let rowRegex = /<TR bgcolor=['"][^'"]*['"][^>]*>([\s\S]*?)<\/TR>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(cleaned)) != null) {
        let row = rowMatch[1];
        if (row.indexOf("/security/summary?idInstr=") < 0) {
            continue;
        }

        let instrumentMatch = row.match(/idInstr=(\d+)/i);
        if (instrumentMatch == null || instrumentMatch[1] == null) {
            continue;
        }

        let cells = [];
        let cellRegex = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(row)) != null) {
            cells.push(cellMatch[1]);
        }

        if (cells.length < 5) {
            continue;
        }

        let isin = stripHtmlTags(cells[0]).toUpperCase();
        if (!looksLikeISIN(isin)) {
            continue;
        }

        let name = stripHtmlTags(cells[1]);
        let currency = extractCurrency(cells[4]);
        let dedupeKey = `${isin}#${instrumentMatch[1]}`;
        if (cached[dedupeKey] === "1") {
            continue;
        }

        let stock = createStock(isin, instrumentMatch[1], name, currency);
        if (stock == null) {
            continue;
        }

        cached[dedupeKey] = "1";
        stocks.push(stock);
    }

    return stocks;
}

function handleResult(keyword, isISIN, html) {
    let stocks = isISIN ? parseSummaryPage(html) : parseSearchRows(html);
    if (stocks.length === 0) {
        stocks = isISIN ? parseSearchRows(html) : parseSummaryPage(html);
    }

    $callback.onNext(stocks.length === 0 ? null : stocks);
    $callback.onCompletion();
}

function search() {
    let keyword = normalizeText($argument.get("keyword"));
    if (keyword === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let isISIN = looksLikeISIN(keyword);
    let request = HTTPRequest.createWithBaseUrl("https://www.fundsquare.net/search-results")
        .params({
            "ajaxContentView": "renderContent",
            "search": keyword,
            "isISIN": isISIN ? "O" : "N",
            "lang": "EN",
            "fastSearch": "O"
        })
        .header("Accept", "text/html")
        .get();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                $callback.onNext(null);
                $callback.onCompletion();
                return;
            }

            handleResult(keyword, isISIN, resp.data);
        });
}

function main() {
    search();
}
