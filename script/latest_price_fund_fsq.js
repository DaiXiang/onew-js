function buildDailyCacheKey(symbol) {
    return `${symbol}_${$date.format("yyyyMMdd")}`;
}

function buildInstrumentCacheKey(isin) {
    return `fsq_instr_${isin}`;
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

function getISINFromSymbol(symbol) {
    if (symbol == null) {
        return null;
    }

    let normalized = normalizeText(symbol).toUpperCase();
    if (!normalized.endsWith(".FUND")) {
        return null;
    }

    let isin = normalized.substring(0, normalized.length - 5);
    return looksLikeISIN(isin) ? isin : null;
}

function isLegacyProviderStock(stockId) {
    if (stockId == null || stockId === "") {
        return false;
    }

    return `${stockId}`.trim().startsWith("frs") || `${stockId}`.trim().startsWith("msf");
}

function normalizeComparableName(text) {
    return normalizeText(text)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\bFD\b/g, " FUND ")
        .replace(/\bGLBL\b/g, " GLOBAL ")
        .replace(/\bSTRAT\b/g, " STRATEGIC ")
        .replace(/\bEQ\b/g, " EQUITY ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeName(text) {
    let normalized = normalizeComparableName(text);
    if (normalized === "") {
        return [];
    }

    return normalized.split(" ").filter(function(token) {
        return token !== "" && (token.length > 1 || /^[A-Z]$/.test(token));
    });
}

function normalizeCurrency(currency) {
    if (currency == null) {
        return null;
    }

    let normalized = normalizeText(currency).toUpperCase();
    return normalized === "" ? null : normalized;
}

function cacheInstrumentIdIfNeed(isin, instrumentId) {
    if (isin == null || isin === "" || instrumentId == null || instrumentId === "") {
        return;
    }
    $cache.savePersistent(buildInstrumentCacheKey(isin), `${instrumentId}`);
}

function getInstrumentIdFromStock(stock) {
    if (stock == null) {
        return null;
    }

    let stockId = stock.stockId == null ? "" : `${stock.stockId}`.trim();
    if (stockId.startsWith("fsq")) {
        let instrumentId = stockId.substring(3);
        return instrumentId === "" ? null : instrumentId;
    }

    let isin = getISINFromSymbol(stock.symbol);
    if (isin == null) {
        return null;
    }

    let cachedValue = $cache.getPersistent(buildInstrumentCacheKey(isin));
    return cachedValue == null || cachedValue === "" ? null : `${cachedValue}`.trim();
}

function extractInstrumentId(html) {
    let cleaned = preprocessHtml(html);
    let match = cleaned.match(/\/security\/(?:summary|price)\?idInstr=(\d+)/i);
    if (match == null || match[1] == null || match[1] === "") {
        return null;
    }
    return `${match[1]}`.trim();
}

function extractLatestPrice(html) {
    let cleaned = preprocessHtml(html);
    let rowRegex = /<TR bgcolor=['"][^'"]*['"][^>]*>([\s\S]*?)<\/TR>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(cleaned)) != null) {
        let cells = [];
        let cellRegex = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) != null) {
            cells.push(cellMatch[1]);
        }

        if (cells.length < 4) {
            continue;
        }

        let dateText = stripHtmlTags(cells[0]);
        let priceText = stripHtmlTags(cells[3]).replace(/\s+/g, "");
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText) || priceText === "" || priceText === "-") {
            continue;
        }

        return priceText;
    }

    return null;
}

function parseSearchCandidates(html) {
    let cleaned = preprocessHtml(html);
    let candidates = [];
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
        let name = stripHtmlTags(cells[1]);
        let currency = extractCurrency(cells[4]);
        if (!looksLikeISIN(isin) || name === "") {
            continue;
        }

        candidates.push({
            instrumentId: `${instrumentMatch[1]}`,
            isin: isin,
            name: name,
            currency: currency
        });
    }

    return candidates;
}

function scoreCandidate(candidate, stock) {
    let candidateName = normalizeComparableName(candidate.name);
    let targetName = normalizeComparableName(stock.name);
    if (candidateName === "") {
        return -1;
    }

    let score = 0;
    if (targetName !== "") {
        if (candidateName === targetName) {
            score += 1000;
        }
        if (candidateName.indexOf(targetName) >= 0 || targetName.indexOf(candidateName) >= 0) {
            score += 200;
        }

        let candidateTokens = new Set(tokenizeName(candidate.name));
        for (const token of tokenizeName(stock.name)) {
            if (!candidateTokens.has(token)) {
                continue;
            }
            score += token.length === 1 ? 5 : 20;
        }
    }

    let stockCurrency = normalizeCurrency(stock.currency);
    let candidateCurrency = normalizeCurrency(candidate.currency);
    if (stockCurrency != null && candidateCurrency != null && stockCurrency === candidateCurrency) {
        score += 100;
    }

    let isin = getISINFromSymbol(stock.symbol);
    if (isin != null && candidate.isin === isin) {
        score += 500;
    }

    return score;
}

function hasExplicitCurrencyMismatch(candidate, stock) {
    let stockCurrency = normalizeCurrency(stock == null ? null : stock.currency);
    let candidateCurrency = normalizeCurrency(candidate == null ? null : candidate.currency);
    return stockCurrency != null && candidateCurrency != null && stockCurrency !== candidateCurrency;
}

function pickBestCandidate(candidates, stock) {
    if (candidates.length === 0) {
        return null;
    }

    let eligibleCandidates = candidates.filter(function(candidate) {
        return !hasExplicitCurrencyMismatch(candidate, stock);
    });
    if (eligibleCandidates.length === 0) {
        return null;
    }
    if (eligibleCandidates.length === 1) {
        return eligibleCandidates[0];
    }

    let bestCandidate = null;
    let bestScore = -1;
    for (const candidate of eligibleCandidates) {
        let score = scoreCandidate(candidate, stock);
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    if (bestCandidate != null && bestScore > 0) {
        return bestCandidate;
    }

    let stockCurrency = normalizeCurrency(stock.currency);
    if (stockCurrency != null) {
        let currencyMatches = eligibleCandidates.filter(function(candidate) {
            return normalizeCurrency(candidate.currency) === stockCurrency;
        });
        if (currencyMatches.length === 1) {
            return currencyMatches[0];
        }
    }

    return null;
}

function resolveInstrumentId(isin, completion) {
    if (isin == null || isin === "") {
        completion(null);
        return;
    }

    let cachedValue = $cache.getPersistent(buildInstrumentCacheKey(isin));
    if (cachedValue != null && cachedValue !== "") {
        completion(`${cachedValue}`.trim());
        return;
    }

    let request = HTTPRequest.createWithBaseUrl("https://www.fundsquare.net/search-results")
        .params({
            "ajaxContentView": "renderContent",
            "search": isin,
            "isISIN": "O",
            "lang": "EN",
            "fastSearch": "O"
        })
        .header("Accept", "text/html")
        .get();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                completion(null);
                return;
            }

            let instrumentId = extractInstrumentId(resp.data);
            if (instrumentId != null && instrumentId !== "") {
                cacheInstrumentIdIfNeed(isin, instrumentId);
            }
            completion(instrumentId);
        });
}

function resolveInstrumentIdByName(stock, completion) {
    let keyword = normalizeText(stock == null ? null : stock.name);
    if (keyword === "") {
        completion(null, null);
        return;
    }

    let request = HTTPRequest.createWithBaseUrl("https://www.fundsquare.net/search-results")
        .params({
            "ajaxContentView": "renderContent",
            "search": keyword,
            "isISIN": "N",
            "lang": "EN",
            "fastSearch": "O"
        })
        .header("Accept", "text/html")
        .get();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                completion(null, null);
                return;
            }

            let candidate = pickBestCandidate(parseSearchCandidates(resp.data), stock);
            if (candidate == null) {
                completion(null, null);
                return;
            }

            cacheInstrumentIdIfNeed(candidate.isin, candidate.instrumentId);
            completion(candidate.instrumentId, candidate.isin);
        });
}

function requestLatestPriceByInstrumentId(symbol, isin, instrumentId, resultDict, completion) {
    let request = HTTPRequest.createWithBaseUrl("https://www.fundsquare.net/security/price")
        .params({
            "idInstr": instrumentId
        })
        .header("Accept", "text/html")
        .get();

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                let price = extractLatestPrice(resp.data);
                if (price != null && price !== "") {
                    resultDict[symbol] = `${price}`;
                    $cache.save(buildDailyCacheKey(symbol), `${price}`);
                    cacheInstrumentIdIfNeed(isin, instrumentId);
                }
            }
            completion();
        });
}

function requestLatestPrice(stock, resultDict, completion) {
    let symbol = stock.symbol;
    let instrumentId = getInstrumentIdFromStock(stock);
    let isin = getISINFromSymbol(symbol);

    if (instrumentId != null && instrumentId !== "") {
        requestLatestPriceByInstrumentId(symbol, isin, instrumentId, resultDict, completion);
        return;
    }

    if (isin == null) {
        resolveInstrumentIdByName(stock, function(resolvedInstrumentId, resolvedISIN) {
            if (resolvedInstrumentId == null || resolvedInstrumentId === "") {
                completion();
                return;
            }

            requestLatestPriceByInstrumentId(symbol, resolvedISIN, resolvedInstrumentId, resultDict, completion);
        });
        return;
    }

    resolveInstrumentId(isin, function(resolvedInstrumentId) {
        if (resolvedInstrumentId == null || resolvedInstrumentId === "") {
            resolveInstrumentIdByName(stock, function(resolvedByName, resolvedISIN) {
                if (resolvedByName == null || resolvedByName === "") {
                    completion();
                    return;
                }

                requestLatestPriceByInstrumentId(symbol, resolvedISIN, resolvedByName, resultDict, completion);
            });
            return;
        }

        requestLatestPriceByInstrumentId(symbol, isin, resolvedInstrumentId, resultDict, completion);
    });
}

function requestByStocks(stocks, resultDict, completion) {
    if (stocks.length === 0) {
        completion();
        return;
    }

    let pending = stocks.length;
    function onRequestFinished() {
        pending--;
        if (pending === 0) {
            completion();
        }
    }

    for (const stock of stocks) {
        requestLatestPrice(stock, resultDict, onRequestFinished);
    }
}

function isMyStock(stock) {
    if (stock == null || stock.symbol == null || stock.symbol === "") {
        return false;
    }

    if (!`${stock.symbol}`.toUpperCase().endsWith(".FUND")) {
        return false;
    }

    let stockId = stock.stockId == null ? "" : `${stock.stockId}`.trim();
    if (stockId.startsWith("fsq")) {
        return true;
    }
    if (isLegacyProviderStock(stockId)) {
        return getISINFromSymbol(stock.symbol) != null;
    }

    return true;
}

function getLatestPriceByStocks(stocks) {
    let resultDict = {};
    let noCachedStocks = [];

    for (const stock of stocks) {
        if (!isMyStock(stock)) {
            continue;
        }

        let symbol = stock.symbol;
        let cachedValue = $cache.get(buildDailyCacheKey(symbol));
        if (cachedValue != undefined) {
            resultDict[symbol] = cachedValue;
        } else {
            noCachedStocks.push(stock);
        }
    }

    if (noCachedStocks.length === 0) {
        $callback.onNext(resultDict);
        $callback.onCompletion();
        return;
    }

    requestByStocks(noCachedStocks, resultDict, function() {
        $callback.onNext(resultDict);
        $callback.onCompletion();
    });
}

function main() {
    let stocks = $argument.get("stocks");
    if (stocks == null || stocks.length === 0) {
        $callback.onNext({});
        $callback.onCompletion();
        return;
    }

    getLatestPriceByStocks(stocks);
}
