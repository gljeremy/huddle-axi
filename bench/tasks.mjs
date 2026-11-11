// Twenty facilitator notes on the sample board, run in this order on a fresh board.
// Each check reads the card's HTML after the agent's patch and says whether the edit
// did what the note asked. The checks are deliberately loose about wording.

const has = (re) => (html) => re.test(html);
const all = (...checks) => (html) => checks.every((c) => c(html));
const not = (check) => (html) => !check(html);
const count = (re, n) => (html) => (html.match(re) ?? []).length === n;

export const TASKS = [
  { card: 'c5', note: 'We picked the progressive wizard. Mark it decided.',
    check: all(has(/data-status="decided"/), has(/<li[^>]*data-chosen[^>]*>\s*Progressive wizard/i)) },
  { card: 'c3', note: 'Activation is up to 44% now. Update the number.',
    check: all(has(/<data value="44">44%<\/data>/), not(has(/41/))) },
  { card: 'c9', note: 'Add a third mitigation: let admins pre-approve data access.',
    check: all(count(/<li>/g, 3), has(/pre-approve/i)) },
  { card: 'c11', note: "Retitle this to 'Invite a teammate during setup'.",
    check: has(/<h3>Invite a teammate during setup<\/h3>/) },
  { card: 'c14', note: 'This one is done now.',
    check: all(has(/<dt>status<\/dt>\s*<dd>done<\/dd>/i), has(/<dd>Design<\/dd>/)) },
  { card: 'c6', note: 'Add one vote to the template gallery.',
    check: all(has(/data-votes="4"[^>]*>\s*Template gallery/i), has(/data-votes="4"[^>]*>\s*Sample dashboard/i)) },
  { card: 'c10', note: 'Lower the severity to low.',
    check: has(/data-severity="low"/) },
  { card: 'c2', note: 'Product owns this now, not Design.',
    check: all(has(/<dt>owner<\/dt>\s*<dd>Product<\/dd>/), not(has(/Design/))) },
  { card: 'c7', note: "Add a third option, 'No onboarding': admins send their own welcome email. No votes yet.",
    check: all(count(/<li/g, 3), has(/No onboarding/i), has(/welcome email/i)) },
  { card: 'c4', note: 'Set the progress to 30.',
    check: has(/data-progress="30"/) },
  { card: 'c12', note: 'Add a sentence saying Sales eng agrees this is easier to ask.',
    check: all(has(/Sales eng/), has(/Role predicts/)) },
  { card: 'c13', note: "Unpark this: say we'll pilot it in July instead.",
    check: all(has(/pilot/i), has(/July/), not(has(/Parked until/))) },
  { card: 'c15', note: 'Support owns this now, due end of month.',
    check: all(has(/<dd>Support<\/dd>/), has(/end of month/i), not(has(/Sales eng/))) },
  { card: 'c8', note: 'Link this to c2 as well as c7.',
    check: all(has(/c2/), has(/c7/)) },
  { card: 'c1', note: "Add a detail row 'reviewed: session 2'.",
    check: all(has(/<dt>reviewed<\/dt>\s*<dd>session 2<\/dd>/), has(/<dt>owner<\/dt>/)) },
  { card: 'c5', note: "Add a detail row 'decided in: session 2'.",
    check: all(has(/<dt>decided in<\/dt>\s*<dd>session 2<\/dd>/), has(/data-status="decided"/)) },
  { card: 'c3', note: "Change the caption to 'target 60% · baseline last 30 days'.",
    check: all(has(/<small>target 60% · baseline last 30 days<\/small>/), has(/44%/)) },
  { card: 'c9', note: 'Drop the demo data mitigation, c6 covers it.',
    check: all(count(/<li>/g, 2), not(has(/Offer demo data/)), has(/pre-approve/i)) },
  { card: 'c6', note: 'Decided: the sample dashboard.',
    check: all(has(/data-status="decided"/), has(/<li[^>]*data-chosen[^>]*>\s*Sample dashboard/i)) },
  { card: 'c11', note: "Add a bullet: 'Offer a skip link for solo users'.",
    check: all(has(/<li>Offer a skip link for solo users<\/li>/i), has(/Invite a teammate during setup/)) },
];
