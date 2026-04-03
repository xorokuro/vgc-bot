const db = JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
['A1', 'A2', 'A2a', 'A2b', 'B2b'].forEach(set => {
    const m = db.cards.filter(c => c.set === set && c.images && c.images.zh_TW && c.images.zh_TW.includes('TR_') && !c.names.zh);
    if (m.length) console.log(set + ': ' + m.map(c => c.uid + ' (' + c.names.en + ')').join(', '));
});
console.log('done');