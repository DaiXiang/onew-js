function setCurrencyIfNeed(stock, currency) {
    if ($app.apiLevel >= 5 && currency != null && currency !== "") {
        stock.currency = currency;
    }
}

function strip(text) {
    if (text == null) {
        return "";
    }
    return `${text}`.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function cleanNumber(text) {
    let value = strip(text).replace(/\$/g, "").replace(/,/g, "");
    if (value === "" || value === "--" || value.toLowerCase() === "nan") {
        return null;
    }
    return value;
}

function padLeft(text, length) {
    let value = `${text}`;
    while (value.length < length) {
        value = `0${value}`;
    }
    return value;
}

function formatStrikeCode(strikeText) {
    let cleaned = cleanNumber(strikeText);
    if (cleaned == null) {
        return null;
    }

    let strike = Number(cleaned);
    if (!isFinite(strike)) {
        return null;
    }
    return padLeft(Math.round(strike * 1000), 8);
}

function formatStrikeName(strikeText) {
    let cleaned = cleanNumber(strikeText);
    if (cleaned == null) {
        return strip(strikeText);
    }
    return Number(cleaned).toFixed(2);
}

function parseDateParts(dateText) {
    let date = new Date(strip(dateText));
    if (isNaN(date.getTime())) {
        return null;
    }

    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    let day = date.getDate();
    return {
        full: `${year}-${padLeft(month, 2)}-${padLeft(day, 2)}`,
        short: `${`${year}`.slice(-2)}${padLeft(month, 2)}${padLeft(day, 2)}`
    };
}

function formatDate(year, month, day) {
    return `${year}-${padLeft(month, 2)}-${padLeft(day, 2)}`;
}

function parseOptionSearchDate(text) {
    let normalized = strip(text);
    if (normalized === "") {
        return null;
    }

    let shortExactMatch = normalized.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (shortExactMatch != null) {
        let year = 2000 + Number(shortExactMatch[1]);
        let month = Number(shortExactMatch[2]);
        let day = Number(shortExactMatch[3]);
        if (isValidDate(year, month, day)) {
            let date = formatDate(year, month, day);
            return { from: date, to: date };
        }
    }

    let compactExactMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
    let separatedExactMatch = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    let exactMatch = compactExactMatch == null ? separatedExactMatch : compactExactMatch;
    if (exactMatch != null) {
        let year = Number(exactMatch[1]);
        let month = Number(exactMatch[2]);
        let day = Number(exactMatch[3]);
        if (isValidDate(year, month, day)) {
            let date = formatDate(year, month, day);
            return { from: date, to: date };
        }
        return null;
    }

    let monthMatch = normalized.match(/^(\d{4})[-/.]?(\d{1,2})$/);
    if (monthMatch != null) {
        let year = Number(monthMatch[1]);
        let month = Number(monthMatch[2]);
        if (month >= 1 && month <= 12) {
            let lastDay = new Date(year, month, 0).getDate();
            return {
                from: formatDate(year, month, 1),
                to: formatDate(year, month, lastDay)
            };
        }
    }

    return null;
}

function isValidDate(year, month, day) {
    let date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function parseOptionSearchKeyword(keyword) {
    let exactOptionSymbol = normalizeOptionSymbol(keyword);
    if (exactOptionSymbol != null) {
        let details = parseOptionSymbolDetails(exactOptionSymbol);
        let dateFilter = details == null ? null : { from: details.date, to: details.date };
        return {
            underlyingKeyword: details == null ? keyword : details.underlying,
            exactOptionSymbol: exactOptionSymbol,
            dateFilter: dateFilter
        };
    }

    let normalized = strip(keyword).toUpperCase();
    let match = normalized.match(/^([A-Z]{1,6})\s+(.+)$/);
    if (match != null) {
        let dateFilter = parseOptionSearchDate(match[2]);
        if (dateFilter != null) {
            return {
                underlyingKeyword: match[1],
                exactOptionSymbol: null,
                dateFilter: dateFilter
            };
        }
    }

    return {
        underlyingKeyword: keyword,
        exactOptionSymbol: null,
        dateFilter: null
    };
}

function normalizeOptionSymbol(symbol) {
    let details = parseOptionSymbolDetails(symbol);
    return details == null ? null : details.symbol;
}

function parseOptionSymbolDetails(symbol) {
    if (symbol == null) {
        return null;
    }

    let normalized = strip(symbol).toUpperCase();
    if (normalized.endsWith(".OPT")) {
        normalized = normalized.substring(0, normalized.length - 4);
    }
    normalized = normalized.replace(/\s+/g, "");

    let match = normalized.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/);
    if (match == null) {
        return null;
    }

    let year = 2000 + Number(match[2].substring(0, 2));
    let month = Number(match[2].substring(2, 4));
    let day = Number(match[2].substring(4, 6));
    return {
        symbol: `${match[1]}${match[2]}${match[3]}${match[4]}.OPT`,
        underlying: match[1],
        date: `${year}-${padLeft(month, 2)}-${padLeft(day, 2)}`
    };
}

function getUnderlyingFromOptionSymbol(symbol) {
    let normalized = normalizeOptionSymbol(symbol);
    if (normalized == null) {
        return null;
    }
    let details = parseOptionSymbolDetails(normalized);
    return details == null ? null : details.underlying;
}

function makeNasdaqRequest(baseUrl) {
    return HTTPRequest.createWithBaseUrl(baseUrl)
        .header("Accept", "application/json, text/plain, */*")
        .header("Origin", "https://www.nasdaq.com")
        .header("Referer", "https://www.nasdaq.com/")
        .header("User-Agent", "Mozilla/5.0");
}

function requestUnderlyingCandidates(keyword, completion) {
    let explicitUnderlying = getUnderlyingFromOptionSymbol(keyword);
    if (explicitUnderlying != null) {
        completion([{ symbol: explicitUnderlying, assetClass: null }]);
        return;
    }

    let normalizedKeyword = strip(keyword).toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(normalizedKeyword)) {
        completion([]);
        return;
    }

    let url = `https://api.nasdaq.com/api/autocomplete/slookup/10?search=${encodeURIComponent(normalizedKeyword)}`;
    HTTPClient.create()
        .request(makeNasdaqRequest(url))
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                completion([{ symbol: normalizedKeyword, assetClass: null }]);
                return;
            }

            let json = null;
            try {
                json = JSON.parse(resp.data);
            } catch (e) {
                completion([{ symbol: normalizedKeyword, assetClass: null }]);
                return;
            }

            let candidates = [];
            let rows = json == null || json.data == null ? [] : json.data;
            for (const row of rows) {
                let symbol = strip(row.symbol).toUpperCase();
                let asset = strip(row.asset).toUpperCase();
                let assetClass = getNasdaqAssetClass(asset);
                if (symbol !== "" && assetClass != null) {
                    candidates.push({ symbol: symbol, assetClass: assetClass });
                }
                if (candidates.length >= 1) {
                    break;
                }
            }
            completion(candidates.length === 0 ? [{ symbol: normalizedKeyword, assetClass: null }] : candidates);
        });
}

function getNasdaqAssetClass(asset) {
    if (asset === "STOCKS" || asset === "STOCK") {
        return "stocks";
    }
    if (asset === "ETF" || asset === "ETFS") {
        return "etf";
    }
    return null;
}

function requestOptionChain(candidate, exactOptionSymbol, dateFilterValue, result, completion) {
    let underlying = candidate.symbol;
    let dateFilter = dateFilterValue == null ? "" : `&fromdate=${encodeURIComponent(dateFilterValue.from)}&todate=${encodeURIComponent(dateFilterValue.to)}`;
    let limit = dateFilterValue == null ? 80 : 2000;
    let assetClasses = candidate.assetClass == null ? ["stocks", "etf"] : [candidate.assetClass];
    requestOptionChainByAssetClass(underlying, assetClasses, 0, dateFilter, limit, exactOptionSymbol, result, completion);
}

function requestOptionChainByAssetClass(underlying, assetClasses, index, dateFilter, limit, exactOptionSymbol, result, completion) {
    if (index >= assetClasses.length) {
        completion();
        return;
    }

    let beforeCount = result.length;
    let assetClass = assetClasses[index];
    let url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(underlying)}/option-chain?assetclass=${assetClass}${dateFilter}&limit=${limit}`;
    HTTPClient.create()
        .request(makeNasdaqRequest(url))
        .onCompletion(function(resp) {
            if (resp.error == null && resp.data !== "") {
                handleOptionChain(underlying, resp.data, exactOptionSymbol, result);
            }
            if (result.length > beforeCount || index >= assetClasses.length - 1) {
                completion();
            } else {
                requestOptionChainByAssetClass(underlying, assetClasses, index + 1, dateFilter, limit, exactOptionSymbol, result, completion);
            }
        });
}

function appendOptionIfNeeded(result, cached, underlying, dateParts, strikeText, type, exactOptionSymbol) {
    let strikeCode = formatStrikeCode(strikeText);
    if (dateParts == null || strikeCode == null) {
        return;
    }

    let optionSymbol = `${underlying}${dateParts.short}${type}${strikeCode}.OPT`;
    if (exactOptionSymbol != null && optionSymbol !== exactOptionSymbol) {
        return;
    }

    if (cached[optionSymbol] === "1") {
        return;
    }
    cached[optionSymbol] = "1";

    let typeName = type === "C" ? "Call" : "Put";
    let stock = Stock.create(optionSymbol, `${underlying} ${dateParts.full} ${typeName} ${formatStrikeName(strikeText)}`);
    setCurrencyIfNeed(stock, "USD");
    result.push(stock);
}

function handleOptionChain(underlying, data, exactOptionSymbol, result) {
    let json = null;
    try {
        json = JSON.parse(data);
    } catch (e) {
        return;
    }

    let rows = json == null || json.data == null || json.data.table == null ? [] : json.data.table.rows;
    let currentExpiry = null;
    let cached = {};

    for (const row of rows) {
        if (row == null) {
            continue;
        }

        let expiryGroup = strip(row.expirygroup);
        if (expiryGroup !== "") {
            currentExpiry = expiryGroup;
            continue;
        }

        let strike = strip(row.strike);
        if (strike === "" || currentExpiry == null) {
            continue;
        }

        let dateParts = parseDateParts(currentExpiry);
        appendOptionIfNeeded(result, cached, underlying, dateParts, strike, "C", exactOptionSymbol);
        appendOptionIfNeeded(result, cached, underlying, dateParts, strike, "P", exactOptionSymbol);
    }
}

function search() {
    let keyword = strip($argument.get("keyword"));
    if (keyword === "") {
        $callback.onNext(null);
        $callback.onCompletion();
        return;
    }

    let parsedKeyword = parseOptionSearchKeyword(keyword);
    requestUnderlyingCandidates(parsedKeyword.underlyingKeyword, function(candidates) {
        if (candidates.length === 0) {
            $callback.onNext(null);
            $callback.onCompletion();
            return;
        }

        let result = [];
        let pending = candidates.length;
        function finishOne() {
            pending--;
            if (pending === 0) {
                $callback.onNext(result.length === 0 ? null : result);
                $callback.onCompletion();
            }
        }

        for (const candidate of candidates) {
            requestOptionChain(candidate, parsedKeyword.exactOptionSymbol, parsedKeyword.dateFilter, result, finishOne);
        }
    });
}

function main() {
    search();
}
