function emptyResult(warnings) {
    return {
        provider: "longbridge",
        balances: [],
        securityPositions: [],
        fundPositions: [],
        loadedSections: [],
        failedSections: [],
        warnings: warnings || []
    };
}

function stringValue(value) {
    if (value == null) {
        return null;
    }
    return `${value}`;
}

function decimalValue(value) {
    if (value == null || value === "") {
        return 0;
    }
    let number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function decimalString(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    let rounded = Math.round(value * 100000000) / 100000000;
    return `${rounded}`;
}

function normalizeMarket(source) {
    let market = stringValue(source == null ? null : source.market);
    return market == null ? null : market.toUpperCase();
}

function padLeft(value, length) {
    value = `${value}`;
    while (value.length < length) {
        value = `0${value}`;
    }
    return value;
}

function normalizeOnewOptionSymbol(symbol) {
    if (symbol == null || symbol === "") {
        return null;
    }

    let normalized = `${symbol}`.trim().toUpperCase().replace(/\s+/g, "");
    let base = normalized;
    if (base.endsWith(".OPT")) {
        base = base.substring(0, base.length - 4);
    } else if (base.indexOf(".") >= 0) {
        base = base.substring(0, base.lastIndexOf("."));
    }

    let match = base.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{1,8})$/);
    if (match == null) {
        return null;
    }

    if (!normalized.endsWith(".OPT") && normalized === base) {
        return null;
    }

    return `${match[1]}${match[2]}${match[3]}${padLeft(match[4], 8)}.OPT`;
}

function normalizeBalance(item) {
    let availableCash = item.available_cash;
    let frozenCash = item.frozen_cash;
    let settlingCash = item.settling_cash;
    let cash = decimalString(decimalValue(availableCash) + decimalValue(frozenCash) + decimalValue(settlingCash));

    let currency = stringValue(item.currency);
    return {
        kind: "cash",
        externalKey: currency,
        currency: currency,
        cash: stringValue(cash),
        availableCash: stringValue(availableCash),
        withdrawCash: stringValue(item.withdraw_cash),
        frozenCash: stringValue(frozenCash),
        settlingCash: stringValue(settlingCash)
    };
}

function normalizeAccountBalances(accountItems) {
    let balances = [];
    for (const account of accountItems) {
        if (Array.isArray(account.cash_infos) && account.cash_infos.length > 0) {
            for (const cashInfo of account.cash_infos) {
                balances.push(normalizeBalance(cashInfo));
            }
        }
    }
    return balances;
}

function normalizeSecurityPosition(item) {
    let symbol = stringValue(item.symbol);
    let market = normalizeMarket(item);
    let optionSymbol = normalizeOnewOptionSymbol(symbol);
    var externalKey = symbol;
    if (externalKey != null && externalKey.indexOf(".") < 0 && market != null) {
        externalKey = `${externalKey}.${market}`;
    }
    externalKey = optionSymbol || externalKey;

    return {
        kind: "security",
        externalKey: externalKey,
        symbol: optionSymbol || externalKey,
        name: stringValue(item.symbol_name),
        market: market,
        currency: stringValue(item.currency),
        quantity: stringValue(item.quantity),
        availableQuantity: stringValue(item.available_quantity),
        costPrice: stringValue(item.cost_price),
        initQuantity: stringValue(item.init_quantity)
    };
}

function normalizeSecurityPositions(accountItems) {
    let positions = [];
    for (const account of accountItems) {
        if (Array.isArray(account.stock_info)) {
            for (const stockInfo of account.stock_info) {
                positions.push(normalizeSecurityPosition(stockInfo));
            }
        }
    }
    return positions.filter(function(position) {
        return position.externalKey != null && position.externalKey !== "";
    });
}

function normalizeFundPosition(item) {
    let symbol = stringValue(item.symbol);
    let quantity = stringValue(item.holding_units);
    let nav = stringValue(item.current_net_asset_value);
    return {
        kind: "fund",
        externalKey: symbol,
        isin: symbol,
        symbol: symbol,
        name: stringValue(item.symbol_name),
        currency: stringValue(item.currency),
        quantity: quantity,
        costPrice: stringValue(item.cost_net_asset_value),
        nav: nav,
        navDate: stringValue(item.net_asset_value_day),
        amount: decimalString(decimalValue(nav) * decimalValue(quantity))
    };
}

function normalizeFundPositions(accountItems) {
    let positions = [];
    for (const account of accountItems) {
        if (Array.isArray(account.fund_info)) {
            for (const fundInfo of account.fund_info) {
                positions.push(normalizeFundPosition(fundInfo));
            }
        }
    }
    return positions.filter(function(position) {
        return position.externalKey != null && position.externalKey !== "";
    });
}

function parseResponseData(data) {
    if (data == null || data === "") {
        return null;
    }
    if (typeof data === "object") {
        return data;
    }
    return JSON.parse(data);
}

function parseLongbridgeListResponse(data, path) {
    let json = parseResponseData(data);
    if (json == null || typeof json !== "object") {
        return { value: null, error: `Invalid response: ${path}` };
    }

    if (json.code !== 0) {
        let code = json.code == null ? "unknown" : json.code;
        let message = stringValue(json.message) || "Longbridge API error";
        return { value: null, error: `${message} (${code}): ${path}` };
    }

    if (json.data == null || !Array.isArray(json.data.list)) {
        return { value: null, error: `Invalid data list: ${path}` };
    }

    return { value: json.data.list, error: null };
}

function requestJSON(baseUrl, path, accessToken, completion) {
    let request = HTTPRequest.createWithBaseUrl(`${baseUrl}${path}`)
        .get()
        .header("Authorization", `Bearer ${accessToken}`)
        .header("Accept", "application/json");

    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            if (resp.error != null || resp.data === "") {
                completion(null, `Request failed: ${path}`);
                return;
            }
            try {
                let parsed = parseLongbridgeListResponse(resp.data, path);
                completion(parsed.value, parsed.error);
            } catch (error) {
                completion(null, `Invalid JSON: ${path}`);
            }
        });
}

function runSync(provider, baseUrl, accessToken) {
    let result = emptyResult([]);
    if (accessToken == null || accessToken === "") {
        result.warnings.push("Missing Longbridge access token");
        $callback.onNext(result);
        $callback.onCompletion();
        return;
    }

    requestJSON(baseUrl, "/v1/asset/account", accessToken, function(accountResp, accountError) {
        if (accountError != null) {
            result.warnings.push(accountError);
            result.failedSections.push("balances");
        } else {
            result.balances = normalizeAccountBalances(accountResp);
            result.loadedSections.push("balances");
        }

        requestJSON(baseUrl, "/v1/asset/stock", accessToken, function(stockResp, stockError) {
            if (stockError != null) {
                result.warnings.push(stockError);
                result.failedSections.push("securityPositions");
            } else {
                result.securityPositions = normalizeSecurityPositions(stockResp);
                result.loadedSections.push("securityPositions");
            }

            requestJSON(baseUrl, "/v1/asset/fund", accessToken, function(fundResp, fundError) {
                if (fundError != null) {
                    result.warnings.push(fundError);
                    result.failedSections.push("fundPositions");
                } else {
                    result.fundPositions = normalizeFundPositions(fundResp);
                    result.loadedSections.push("fundPositions");
                }

                $callback.onNext(result);
                $callback.onCompletion();
            });
        });
    });
}

function main() {
    let provider = $argument.get("provider") || "longbridge";
    let baseUrl = $argument.get("baseUrl");
    let accessToken = $argument.get("accessToken");
    runSync(provider, baseUrl, accessToken);
}
