const fs = require('fs');
const html = fs.readFileSync('b.html', 'utf8');

const markerStart = '<script id="__NEXT_DATA__" type="application/json">';
const markerEnd = '</script>';

const idx1 = html.indexOf(markerStart);
if (idx1 !== -1) {
    const jsonStr = html.substring(idx1 + markerStart.length, html.indexOf(markerEnd, idx1));
    const data = JSON.parse(jsonStr);
    
    // Cari itemInfo
    let foundItem = null;
    const findItem = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.models && obj.item_rating) return obj;
        if (obj.models && Array.isArray(obj.models) && obj.models.length > 0 && obj.models[0].price) return obj;
        
        for (const key of Object.keys(obj)) {
            const result = findItem(obj[key]);
            if (result) return result;
        }
        return null;
    };
    
    foundItem = findItem(data);
    if (foundItem) {
        console.log('Item found!');
        console.log('models count:', foundItem.models ? foundItem.models.length : 0);
        if (foundItem.models && foundItem.models.length > 0) {
            console.log('Sample model keys:', Object.keys(foundItem.models[0]).join(', '));
            console.log('Sample model sold data:', {
                sold: foundItem.models[0].sold,
                historical_sold: foundItem.models[0].historical_sold,
                item_sold: foundItem.models[0].item_sold,
                normal_stock: foundItem.models[0].normal_stock,
                price: foundItem.models[0].price
            });
        }
    } else {
        console.log('Item not found in NEXT_DATA');
    }
} else {
    console.log('NEXT_DATA element not found in HTML');
}
