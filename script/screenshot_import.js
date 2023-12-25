function handleTextNode() {
    var nodeList = $argument.get("node");
    let allText = $argument.get("allText");
    
    if (/名称.+金额\/昨日收益/.test(allText)) { // 支付宝基金持仓列表
        nodeList = handleByNameAndAmount(nodeList, /金额\/昨日收益/, /名称/, false, true);
    } else if (/(名称代码|代码名称).+市值 ?[\/|] ?数量|市值 ?[\/|] ?数量.+(名称代码|代码名称)/.test(allText)) { // 港美股券商持仓列表
        nodeList = handleByNameAndAmount(nodeList, /市值 ?[\/|] ?数量/, /名称代码|代码名称/, true, false);
    } else if (/金额\/今日收益/.test(allText)) { // 京东金融基金持仓列表
        nodeList = handleByNameAndAmount(nodeList, /金额\/今日收益/, /持有收益率排序/, false, true);
    } else if (/(证券|名称) ?\/ ?市值| 市值/.test(allText)) { // 国内证券 App 持仓列表
        nodeList = handleByCommon(nodeList, /(证券|名称) ?\/ ?市值|^市值/);
    } else if (/公募基金资产/.test(allText)) { // 蜻蜓点金基金持仓列表
        nodeList = handleByCommon2(nodeList, /交易查询/, 0);
    } else if (/资产明细/.test(allText)) { // 腾讯理财通
        nodeList = handleByCommon2(nodeList, /资产明细/, 1);
    } else if (/金额.+昨日收益.+持仓收益\/率/.test(allText)) { // 招商银行基金持仓列表
        nodeList = handleByCommon3(nodeList, /^金额$/);
    }
    
    for (const item of nodeList) {
        if (item.type == 1) {
            item.text = fixNameIfNeed(item.text);
        }
    }
    
    $callback.onNext(nodeList);
    $callback.onCompletion();
}

function handleByCommon3(list, keyOfAnchor) {
    // 查找锚点
    let anchor = list.find(node => keyOfAnchor.test(node.text));
    if (anchor == undefined) return list;
    
    // 筛选出与锚点同列的文本
    var items = list.filter(function(item) {
        return isSameColumn(anchor.rect, item.rect);
    });
    
    // 将筛选结果以 y 进行升序排序
    items.sort((a, b) => a.rect.y - b.rect.y);
    
    for (var index = 0; index < items.length; index++) {
        // 先找锚点
        if (!keyOfAnchor.test(items[index].text)) {
            continue;
        }
        // 首尾的锚点无效
        if (index == 0 || index == items.length - 1) {
            continue;
        }
        // 确认锚点下方为数字
        if (!isNumber(items[index + 1])) {
            continue;
        }
        
        items[index + 1].type = 2;
        items[index - 1].type = 1;
        items[index - 1].isHead = true;
        items[index - 1].next = items[index + 1];
    }
    
    return list;
}

function handleByCommon2(list, keyOfAnchor, space) {
    // 查找锚点
    let anchor = list.find(node => keyOfAnchor.test(node.text));
    if (anchor == undefined) return list;
    
    // 筛选出与锚点同列，且在其下方的文本
    var items = list.filter(function(item) {
        return isSameColumnAndUnder(anchor.rect, item.rect);
    });
    
    // 将筛选结果以 y 进行升序排序
    items.sort((a, b) => a.rect.y - b.rect.y);
    
    // 查找筛选结果中第一个纯数字文本
    let indexOfFirstNumber = items.findIndex(item => isNumber(item));
    if (indexOfFirstNumber < 0) return list;
    
    // 如果 index 为 0，则这一条记录无效
    let startIndex = (indexOfFirstNumber > (0 + space)) ? (indexOfFirstNumber - (1 + space)) : (indexOfFirstNumber + 1);
    var indexOfName = startIndex;
    // 先找纯数字文本，再往上标记标题
    for (var index = startIndex; index < items.length; index++) {
        if (isNumber(items[index])) {
            items[index].type = 2;
            indexOfName = index - (1 + space);
            items[indexOfName].type = 1;
            items[indexOfName].isHead = true;
            items[indexOfName].next = items[index];
        }
    }
    
    return list;
}
                                     
function handleByCommon(list, keyOfAnchor) {
    // 查找锚点
    let anchor = list.find(node => keyOfAnchor.test(node.text));
    if (anchor == undefined) return list;
    
    // 筛选出与锚点同列，且在其下方的文本
    var items = list.filter(function(item) {
        return isSameColumnAndUnder(anchor.rect, item.rect);
    });
    
    // 将筛选结果以 y 进行升序排序
    items.sort((a, b) => a.rect.y - b.rect.y);
    
    // 查找筛选结果中第一个纯数字文本
    let indexOfFirstNumber = items.findIndex(item => isNumber(item));
    if (indexOfFirstNumber < 0) return list;
    
    // 将查找结果下一个文本定为资产名称
    // 接着找下一个纯数字文本，成对标记
    // 依次类推，直到筛选结果遍历完全
    let startIndex = indexOfFirstNumber + 1;
    var indexOfName = startIndex;
    var spacing = 0;
    var count = 0;
    for (var index = startIndex; index < items.length; index++) {
        if (isNumber(items[index])) {
            items[index].type = 2;
            items[indexOfName].type = 1;
            items[indexOfName].isHead = true;
            items[indexOfName].next = items[index];
            
            count += 1;
            let rect = items[indexOfName].rect;
            spacing += items[index].rect.y - rect.y - rect.height;
            
            indexOfName = index + 1;
        }
    }
    
    if (count > 0) {
        // 计算出名称与市值文本之间的平均间距，反推第一个资产名称是否存在
        let avgSpace = spacing / count;
        let allowableErrValue = 2;
        for (var index = 0; index < indexOfFirstNumber; index++) {
            let rect = items[index].rect;
            let space = items[indexOfFirstNumber].rect.y - rect.y - rect.height;
            if (Math.abs(avgSpace - space) < allowableErrValue) {
                items[index].type = 1;
                items[index].isHead = true;
                items[indexOfFirstNumber].type = 2;
                items[index].next = items[indexOfFirstNumber];
                break;
            }
        }
    } else {
        // 可能只存在一条持仓记录
        // 直接取第一个为名称
        if (indexOfFirstNumber > 0) {
            items[indexOfFirstNumber].type = 2;
            items[0].type = 1;
            items[0].isHead = true;
            items[0].next = items[indexOfFirstNumber];
        }
    }
    
    return list;
}

function handleByNameAndAmount(list, keyOfAmount, keyOfName, fixAmount, fixName) {
    // 查找锚点-金额
    let amountAnchor = list.find(node => keyOfAmount.test(node.text));
    if (amountAnchor == undefined) return list;
    
    // 筛选出与锚点同列，且在其下方的文本
    var amountItems = list.filter(function(item) {
        return isSameColumnAndUnder(amountAnchor.rect, item.rect) && isNumber(item);
    });
    
    // 按 y 坐标升序排序
    amountItems.sort((a, b) => a.rect.y - b.rect.y);
    
    if (fixAmount) {
        amountItems = fixAmountColumn(amountItems);
    }
    
    // 间距 space 太近的不要
    let minItemSpacing = 16;
    var lastItem;
    amountItems = amountItems.filter(function(item) {
        var result = true;
        if (lastItem != undefined) {
            let space = item.rect.y - lastItem.rect.y - lastItem.rect.height;
            if (space < minItemSpacing) {
                result = false;
            }
        }
        if (result) {
            lastItem = item;
        }
        return result;
    });
    
    // 查找锚点-名称
    let nameAnchor = list.find(node => keyOfName.test(node.text));
    if (nameAnchor == undefined) return list;
    
    // 筛选出与锚点同列，且在其下方的文本
    var nameItems = list.filter(item => isSameColumnAndUnder(nameAnchor.rect, item.rect));
    
    // 按 y 坐标升序排序
    nameItems.sort((a, b) => a.rect.y - b.rect.y);
    
    // 从名称中选出与金额同行的，成对标记
    for (const anchor of amountItems) {
        let items = nameItems.filter(function(item) {
            let isNotName = /^(蚂蚁理财)|(蚂蚊理财)|(组合)|(金选)|(釜选)|(超额收益)/.test(item.text);
            let isSecLine = fixName && isSameRowAndUnder(anchor.rect, item.rect, 6);
            return !isNotName && (isSameRowAndBefore(anchor.rect, item.rect) || isSecLine);
        });
        if (items.length > 0) {
            var preItem = items[0];
            preItem.isHead = true;
            preItem.type = 1;
            for (var index = 1; index < items.length; index++) {
                items[index].type = 1;
                preItem.next = items[index];
                preItem = items[index];
            }
            anchor.type = 2;
            preItem.next = anchor;
        }
    }
    
    return list;
}

function fixAmountColumn(list) {
    // 筛选出同行左侧文本
    var newItems = [];
    var lastItem;
    
    for (const item of list) {
        if (lastItem == undefined) {
            lastItem = item;
            continue;
        }
        
        var appendItem;
        if (isSameRow(item.rect, lastItem.rect)) {
            if (lastItem.rect.x < item.rect.x) {
                appendItem = lastItem;
            } else {
                appendItem = item;
            }
            lastItem = undefined;
        } else {
            appendItem = lastItem;
            lastItem = item;
        }
        newItems.push(appendItem);
    }
    
    return newItems;
}

function isNumber(node) {
    if (node.text.includes("+") || node.text.includes("-")) {
        return false;
    }
    let string = rebuildTextToNum(node.text);
    if (isDouble(string)) {
        node.text = string;
        return true;
    }
    return false;
}

function isDouble(str) {
    return /^\d+(\.\d+)?$/.test(str);
}

function rebuildTextToNum(text) {
    var string = text;
    if (string.includes(",")) {
        string = string.replace(",", "");
    }
    // 有些 "," 会被识别成 "."，处理成仅保留最后一个 "."
    var pointCount = 0;
    string = string.split('').reverse().filter(function(char) {
        if (char == '.') {
            pointCount += 1;
        }
        if (char == '.' && pointCount > 1) {
            return false;
        }
        return true;
    }).reverse().join('');
    return string;
}

function isSameRowAndUnder(anchorRect, rect, allowableErrSpace) {
    let space = rect.y - anchorRect.y - anchorRect.height
    return space > 0 && space <= allowableErrSpace
}

function isSameRowAndBefore(anchorRect, rect) {
    if (rect.x + rect.width > anchorRect.x) {
        return false;
    }
    if (rect.y > anchorRect.y + anchorRect.height) {
        return false;
    }
    if (rect.y + rect.height < anchorRect.y) {
        return false;
    }
    return true;
}

function isSameColumnAndUnder(anchorRect, rect) {
    if (rect.y < anchorRect.y + anchorRect.height) {
        return false;
    }
    return isSameColumn(anchorRect, rect);
}

function isSameRow(anchorRect, rect) {
    if (rect.y > anchorRect.y + anchorRect.height) {
        return false;
    }
    if (rect.y + rect.height < anchorRect.y) {
        return false;
    }
    return true;
}

function isSameColumn(anchorRect, rect) {
    if (rect.x >= anchorRect.x + anchorRect.width) {
        return false;
    }
    if (rect.x + rect.width <= anchorRect.x) {
        return false;
    }
    return true;
}

function fixNameIfNeed(name) {
    var fixedName = name.replace(" ", "");
    fixedName = fixedName.replace(/[\(（]?QD[0-9a-zD-Z]{0,2}[\)）]?(?=[AC]?)$/, "(QDII)");
    fixedName = fixedName.replace(/^夭弘/, "天弘");
    fixedName = fixedName.replace(/创山板/, "创业板");
    fixedName = fixedName.replace(/[\(（]净值[：:][0-9\.]+[\)）]/, "");
    return fixedName;
}

function main() {
    handleTextNode();
}
