const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const bodyContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const wrapped = `<!doctype html><html><head><meta charset="utf-8"></head><body>${bodyContent}</body></html>`;

const errors = [];
const dom = new JSDOM(wrapped, {
  runScripts: 'dangerously',
  resources: 'usable',
  url: 'https://example.com/',
  pretendToBeVisual: true,
});

dom.window.onerror = (msg, src, line, col, err) => {
  errors.push(`${msg} @ ${line}:${col}`);
};
dom.window.navigator.clipboard = { writeText: () => Promise.resolve() };

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(200);

  const doc = dom.window.document;
  const log = (label, cond) => console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);

  log('no runtime errors on load', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));

  const totalDayCards = doc.querySelectorAll('.day-card').length;
  log('day cards rendered across all weeks (4 weeks x 4 days)', totalDayCards === 16);

  const activePanelCards = doc.querySelector('.week-panel.active').querySelectorAll('.day-card').length;
  log('active week panel shows 4 day cards', activePanelCards === 4);

  const sub = doc.getElementById('programSub').textContent;
  log('program sub shows TM figures', /TM/.test(sub));

  // --- squat starts with no accessories in default state; triumvirate should seed it ---
  const templateSelect = doc.getElementById('templateSelect');
  templateSelect.value = 'triumvirate';
  templateSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  // exercise names live in input[value], not text nodes, so read .value not .textContent
  function nameValues(block) { return Array.from(block.querySelectorAll('[data-field="name"]')).map(i => i.value); }
  const squatBlockBefore = Array.from(doc.querySelectorAll('.accessory-lift')).find(b => b.querySelector('h3').textContent.includes('Squat'));
  const squatNames = nameValues(squatBlockBefore);
  log('triumvirate auto-seeds Assistance 1/2 for a lift with no prior accessories (squat)', squatNames.includes('Assistance 1') && squatNames.includes('Assistance 2'));
  const ohpBlockBefore = Array.from(doc.querySelectorAll('.accessory-lift')).find(b => b.querySelector('h3').textContent.includes('Overhead'));
  const ohpNames = nameValues(ohpBlockBefore);
  log('triumvirate leaves existing accessories alone (ohp still has Dip)', ohpNames.includes('Dip') && !ohpNames.includes('Assistance 1'));

  // --- 3 days/week rotation ---
  const daysSelect = doc.getElementById('daysSelect');
  daysSelect.value = '3';
  daysSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  const week1Days = doc.querySelectorAll('[data-week-panel="1"] .day-card').length;
  const week2Days = doc.querySelectorAll('[data-week-panel="2"] .day-card').length;
  log('3 days/week -> 3 day cards per week', week1Days === 3 && week2Days === 3);

  // --- unit switching ---
  doc.querySelector('[data-unit="lbs"]').click();
  await wait(20);
  log('no errors after unit switch to lbs', errors.length === 0);
  log('bar weight defaulted to 45 for lbs', doc.getElementById('barInput').value === '45');
  doc.querySelector('[data-unit="kg"]').click();
  await wait(20);
  log('no errors after unit switch back to kg', errors.length === 0);

  // --- reset to a clean, predictable state for the weighted-accessory test ---
  templateSelect.value = 'standard';
  templateSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  daysSelect.value = '4';
  daysSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);

  function squatAccessoryBlock() {
    return Array.from(doc.querySelectorAll('.accessory-lift')).find(b => b.querySelector('h3').textContent.includes('Squat'));
  }

  doc.querySelector('[data-add-lift="squat"]').click();
  await wait(20);

  let rows = squatAccessoryBlock().querySelectorAll('.exrow');
  let lastRow = rows[rows.length - 1];
  const nameInput = lastRow.querySelector('[data-field="name"]');
  nameInput.value = 'Front Squat';
  nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  // input handler on name doesn't re-render controls (only output), so the row element is still live here
  const weightedCheck = lastRow.querySelector('[data-field="weighted"]');
  weightedCheck.checked = true;
  weightedCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await wait(20); // this triggers a full render() -> re-query fresh nodes below

  rows = squatAccessoryBlock().querySelectorAll('.exrow');
  lastRow = rows[rows.length - 1];
  const wtInput = lastRow.querySelector('[data-field="weight"]');
  log('weighted accessory shows a weight input after re-render', !!wtInput);

  if (wtInput) {
    wtInput.value = '61.5';
    wtInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(20);
  }

  const squatCard = Array.from(doc.querySelectorAll('.day-card')).find(c => c.querySelector('h3').textContent === 'Squat');
  log('Front Squat accessory appears in squat day card', /Front Squat/.test(squatCard.textContent));
  log('Front Squat shows the exact weight (61.5) and plates', /61\.5/.test(squatCard.textContent));

  // sanity: the accessory weight should feed into the plate combo, not just display text
  const frontSquatLabel = Array.from(squatCard.querySelectorAll('.section-label')).find(el => el.textContent.includes('Front Squat'));
  const frontSquatList = frontSquatLabel ? frontSquatLabel.nextElementSibling : null;
  const hasBadges = frontSquatList ? frontSquatList.querySelectorAll('.badge').length > 0 : false;
  log('Front Squat (61.5kg, not reachable exactly in 1.25kg steps) still renders a best-effort plate badge', hasBadges);
  const approxBadge = frontSquatList ? frontSquatList.querySelector('.badge.approx') : null;
  log('inexact loading is flagged as approximate rather than silently wrong', !!approxBadge && /closest available/.test(approxBadge.getAttribute('title') || ''));

  // --- focus retention: typing a training max should not rebuild the input out from under the user ---
  const ohpMaxInput = doc.querySelector('[data-lift="ohp"][data-field="value"]');
  ohpMaxInput.focus();
  ohpMaxInput.value = '65';
  ohpMaxInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  log('typing a training max keeps the same input element (no focus-stealing rebuild)', doc.activeElement === ohpMaxInput && ohpMaxInput.isConnected);
  const subAfterMaxEdit = doc.getElementById('programSub').textContent;
  log('TM output updates live while typing', subAfterMaxEdit !== sub);

  // --- zero out every plate quantity: should degrade to "no plates selected" without crashing ---
  doc.querySelectorAll('[data-plate-qty]').forEach(inp => {
    inp.value = '0';
    inp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await wait(20);
  log('no errors when all plate quantities zeroed', errors.length === 0);
  const anyNoPlatesNote = doc.body.textContent.includes('no plates selected');
  log('with no plates selected, sets show "no plates selected" rather than blank', anyNoPlatesNote);

  // restore some plate inventory for the remaining checks. Quantities are PER SIDE
  // (how many of that plate go on one side of the bar), not total owned.
  doc.querySelector('[data-plate-qty="20"]').value = '1'; // only one 20kg per side
  doc.querySelector('[data-plate-qty="20"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-plate-qty="15"]').value = '0'; // none owned
  doc.querySelector('[data-plate-qty="15"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-plate-qty="10"]').value = '4';
  doc.querySelector('[data-plate-qty="10"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-plate-qty="2.5"]').value = '4';
  doc.querySelector('[data-plate-qty="2.5"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-plate-qty="1.25"]').value = '4';
  doc.querySelector('[data-plate-qty="1.25"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);

  log('plate quantity input reflects what was typed (per side)', doc.querySelector('[data-plate-qty="20"]').value === '1');

  // --- For Beginners template: fixed 3-day split (Squat+Bench practice, Deadlift+OHP
  // both full, Bench+Squat practice), independent of the days-per-week / lift-order
  // controls. Verified against a real screenshot of the reference calculator's
  // default "For Beginners" output. ---
  templateSelect.value = 'beginners';
  templateSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  log('For Beginners appears in the template dropdown', Array.from(templateSelect.options).some(o => o.value === 'beginners'));
  log('no errors after selecting For Beginners', errors.length === 0);

  const beginnersDayCards = Array.from(doc.querySelectorAll('[data-week-panel="1"] .day-card'));
  log('Beginners generates exactly 3 day cards (Squat+Bench, Deadlift+OHP, Bench+Squat)', beginnersDayCards.length === 3);

  const cardTitle = c => c.querySelector('h3').textContent;
  const cardDayIdx = c => c.querySelector('.day-idx').textContent;
  // pulls the weight out of a set-row's "5 × 82.5 kg" style load text
  const rowWeight = row => {
    const m = row.querySelector('.set-load').textContent.match(/×\s*([\d.]+)/);
    return m ? parseFloat(m[1]) : NaN;
  };
  const firstSetWeight = list => {
    const row = list && list.querySelector('.set-row');
    return row ? rowWeight(row) : NaN;
  };
  const squatDay = beginnersDayCards.find(c => cardTitle(c) === 'Squat');
  const deadliftDay = beginnersDayCards.find(c => cardTitle(c) === 'Deadlift');
  const benchDay = beginnersDayCards.find(c => cardTitle(c) === 'Bench Press');
  log('Squat is "Day 1", Deadlift is "Day 2", Bench is "Day 3"',
    !!squatDay && !!deadliftDay && !!benchDay &&
    cardDayIdx(squatDay) === 'Day 1' && cardDayIdx(deadliftDay) === 'Day 2' && cardDayIdx(benchDay) === 'Day 3');
  log('Squat day has a Bench practice section', !!squatDay && /Bench Press — practice sets/.test(squatDay.textContent));
  log('Bench day has a Squat practice section', !!benchDay && /Squat — practice sets/.test(benchDay.textContent));
  log('Deadlift day has a full Overhead Press section, not a practice section', !!deadliftDay && /Overhead Press/.test(deadliftDay.textContent) && !/practice sets/.test(deadliftDay.textContent));

  // Overhead Press on the Deadlift day trains at FULL intensity (its own complete
  // warmup+work wave), not the reduced 3-set practice block Squat/Bench give each
  // other — so it should show 6 rows (3 warmup + 3 work), same shape as any main lift.
  if (deadliftDay) {
    const ohpList = deadliftDay.querySelectorAll('.set-list')[1];
    const ohpRows = ohpList ? ohpList.querySelectorAll('.set-row').length : 0;
    log('Overhead Press gets a full 6-row wave (warmup+work), not a 3-row practice block', ohpRows === 6);
  } else {
    log('Overhead Press gets a full 6-row wave (warmup+work), not a 3-row practice block', false);
  }

  // the Squat/Bench practice sets are fixed at 55/65/75% of the partner lift's OWN
  // training max, not following the main 5/3/1 wave (so this should hold every week)
  const benchTmText = doc.getElementById('programSub').textContent;
  const benchTmMatch = benchTmText.match(/Bench ([\d.]+)/);
  if (benchTmMatch && squatDay) {
    const benchTm = parseFloat(benchTmMatch[1]);
    const expected55 = Math.round(benchTm * 0.55 / 2.5) * 2.5;
    // the practice block is the second .set-list in the Squat day card (after the main-lift list)
    const practiceList = squatDay.querySelectorAll('.set-list')[1];
    const actualWeight = firstSetWeight(practiceList);
    log('practice-set weight on the Squat day matches 55% of Bench\'s own TM', actualWeight === expected55);
  } else {
    log('practice-set weight on the Squat day matches 55% of Bench\'s own TM', false);
  }

  // deload week: a "practice" light partner (Squat/Bench pairing) is skipped entirely,
  // but a "full" light partner (Overhead Press) keeps waving, same as any main lift
  const week4Panel = doc.querySelector('[data-week-panel="4"]');
  if (week4Panel) {
    const week4SquatDay = Array.from(week4Panel.querySelectorAll('.day-card')).find(c => cardTitle(c) === 'Squat');
    log('Squat/Bench practice sets are skipped on the deload week', !!week4SquatDay && /skipped on the deload week/.test(week4SquatDay.textContent));
    const week4DeadliftDay = Array.from(week4Panel.querySelectorAll('.day-card')).find(c => cardTitle(c) === 'Deadlift');
    const week4OhpList = week4DeadliftDay ? week4DeadliftDay.querySelectorAll('.set-list')[1] : null;
    const week4OhpRows = week4OhpList ? week4OhpList.querySelectorAll('.set-row').length : 0;
    log('Overhead Press still trains on the deload week (3 work rows, warmups skipped like any main lift)', week4OhpRows === 3);
  } else {
    log('Squat/Bench practice sets are skipped on the deload week', false);
    log('Overhead Press still trains on the deload week (3 work rows, warmups skipped like any main lift)', false);
  }

  // days/week and lift-order controls should be disabled and clearly marked as inert
  log('Days per week select is disabled while Beginners is active', daysSelect.disabled === true);
  log('a hint explains the fixed schedule while Beginners is active', doc.getElementById('beginnersScheduleHint').style.display !== 'none');

  // --- plate-quantity limiting: with only ONE 20kg plate per side, a target that
  // greedily wants two 20s should fall back to an achievable combo instead of
  // silently pretending it has plates it doesn't ---
  // set OHP very high so a work set needs > 20kg/side, forcing a choice between plates
  const ohpInputAgain = doc.querySelector('[data-lift="ohp"][data-field="value"]');
  ohpInputAgain.value = '200';
  ohpInputAgain.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  // 1x 20kg per side owned = at most one 20kg badge per set, ever (a second 20 would
  // show as a second separate badge reading "20", not a combined "20×2")
  const setRowsForInventoryCheck = Array.from(doc.querySelectorAll('.day-card .set-row'));
  const anyDoubleTwenty = setRowsForInventoryCheck.some(row => {
    const twenties = Array.from(row.querySelectorAll('.badge')).filter(b => b.textContent.trim() === '20');
    return twenties.length > 1;
  });
  log('plate inventory cap respected: no set uses more 20kg per side than the 1 owned', !anyDoubleTwenty);
  // 0x 15kg per side owned = should never appear in any plate breakdown
  const any15Used = Array.from(doc.querySelectorAll('.day-card .badge')).some(b => b.textContent.trim() === '15');
  log('a plate set to 0 per side is never used', !any15Used);
  log('no errors after inventory-constrained generation', errors.length === 0);

  // --- regression: a reachable exact combo must not lose out to an inexact one just
  // because reusing the previous set's plates needed fewer changes. This is the bug
  // reported live: squat's 65% set (127.5 TM -> 31.25kg/side) came back as
  // "5 + 20 + 2.5 + 1.25" (28.75, short by a whole 2.5) even though a 10kg plate was
  // available and 20+10+1.25 hits it exactly. ---
  templateSelect.value = 'standard';
  templateSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  daysSelect.value = '4';
  daysSelect.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  const tmModeBtn = doc.querySelector('[data-mode="tm"]');
  tmModeBtn.click();
  await wait(20);
  const squatValueInput = doc.querySelector('[data-lift="squat"][data-field="value"]');
  squatValueInput.value = '127.5';
  squatValueInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  // restore the exact per-side inventory from the bug report
  const platesForRepro = { '25': 2, '20': 2, '15': 1, '10': 2, '5': 2, '2.5': 2, '1.25': 1 };
  Object.keys(platesForRepro).forEach(w => {
    const inp = doc.querySelector(`[data-plate-qty="${w}"]`);
    inp.value = String(platesForRepro[w]);
    inp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await wait(20);
  const squatCardRepro = Array.from(doc.querySelectorAll('[data-week-panel="1"] .day-card')).find(c => cardTitle(c) === 'Squat');
  log('squat day card found for plate-accuracy regression check', !!squatCardRepro);
  // only the main lift's own set-list: the "Front Squat" accessory added earlier
  // (61.5kg, genuinely unreachable in 1.25kg steps) is SUPPOSED to say "closest
  // available" and lives in its own section now, so it's naturally excluded here —
  // this check is about the barbell work sets, which should now always be exact
  // given the inventory used here.
  const mainList = squatCardRepro ? squatCardRepro.querySelectorAll('.set-list')[0] : null;
  const barbellRows = mainList ? Array.from(mainList.querySelectorAll('.set-row')) : [];
  const barbellText = barbellRows.map(row => row.textContent).join(' ');
  log('no "closest available" fallback text on the main lift sets when an exact combo is reachable', barbellRows.length > 0 && !/closest available/.test(barbellText));
  // cross-check the 65% row (31.25kg/side, 82.5kg total) actually sums to the target,
  // not just short by one plate the way the bug report showed
  const row65 = barbellRows.find(row => row.querySelector('.set-load').textContent.includes('82.5'));
  const row65Badges = row65 ? Array.from(row65.querySelectorAll('.badge')).map(b => parseFloat(b.textContent)) : [];
  const plateSum = row65Badges.reduce((a, b) => a + b, 0);
  log('82.5kg row plate breakdown sums to the correct 31.25kg/side (not short a plate)', Math.abs(plateSum - 31.25) < 1e-6);

  // --- regression: a target below the bar's own weight can't physically be loaded
  // lighter than an empty bar, so the DISPLAYED weight should floor to the bar
  // weight, not show some impossible sub-bar number next to a "bar only" note ---
  const ohpLowInput = doc.querySelector('[data-lift="ohp"][data-field="value"]');
  ohpLowInput.value = '12'; // TM mode is already active from the squat check above; 12 is well under the 20kg bar
  ohpLowInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(20);
  const ohpCardLow = Array.from(doc.querySelectorAll('[data-week-panel="1"] .day-card')).find(c => cardTitle(c) === 'Overhead Press');
  const ohpRows = ohpCardLow ? Array.from(ohpCardLow.querySelectorAll('.set-row')) : [];
  const ohpWeights = ohpRows.map(rowWeight);
  const anySubBarWeight = ohpWeights.some(w => w < 20);
  log('a below-bar target displays as the bar weight, never a lighter impossible number', ohpWeights.length > 0 && !anySubBarWeight);
  const anyBarOnlyNote = ohpCardLow && /bar only/.test(ohpCardLow.textContent);
  log('a below-bar target is still flagged "bar only" in the plates column', !!anyBarOnlyNote);

  // --- plate badges: heaviest plate listed first (the one most likely to stay on the
  // bar between sets), and no "per side" suffix anywhere ---
  const badgeRowsForOrder = Array.from(doc.querySelectorAll('.day-card .set-row'))
    .filter(row => row.querySelectorAll('.badge:not(.note)').length > 0);
  log('found plate breakdown badges to check ordering on', badgeRowsForOrder.length > 0);
  const allDescending = badgeRowsForOrder.every(row => {
    const weights = Array.from(row.querySelectorAll('.badge:not(.note)')).map(b => parseFloat(b.textContent));
    return weights.every((w, i) => i === 0 || w <= weights[i - 1] + 1e-9);
  });
  log('plate breakdowns list the heaviest plate first', allDescending);
  const noPerSideSuffix = !Array.from(doc.querySelectorAll('.day-card .badge')).some(b => /per side/.test(b.textContent));
  log('plate breakdown text no longer says "per side"', noPerSideSuffix);

  // --- print button: this is a plain hosted page (not a sandboxed artifact preview),
  // so it just calls window.print() directly ---
  let printCalled = false;
  const originalPrint = dom.window.print;
  dom.window.print = () => { printCalled = true; };
  doc.getElementById('printBtn').click();
  log('print button calls window.print() directly', printCalled === true);
  dom.window.print = originalPrint;
  log('no errors after exercising the print button', errors.length === 0);

  // --- print output structure ---
  const weekHeadings = doc.querySelectorAll('.week-print-heading');
  log('print-only week headings exist (one per week panel)', weekHeadings.length === doc.querySelectorAll('.week-panel').length && weekHeadings.length > 0);
  const dayCardsWrapper = doc.querySelectorAll('.week-panel .day-cards');
  log('day cards are wrapped for the print grid layout', dayCardsWrapper.length === doc.querySelectorAll('.week-panel').length);

  console.log('\nFINAL total runtime errors:', errors.length);
  if (errors.length) { console.log('Errors captured:', errors); process.exitCode = 1; }
})();
