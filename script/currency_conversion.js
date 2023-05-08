function main() {
    let baseUrl = "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/usd/cny.json";
    let request = HTTPRequest.createWithBaseUrl(baseUrl);
    HTTPClient.create()
        .request(request)
        .onCompletion(function(resp) {
            $console.log("\n" + resp.data);
        });
}

main();
