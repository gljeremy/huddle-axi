// A realistic sample board (the step 0 benchmark meeting) in the card format.
// Used by `huddle-axi new --sample`, the demo build and the tests.

export const SAMPLE = {
  title: 'Q3 onboarding redesign',
  subtitle: 'Working session 2 of 3 · Product, Design, Support, Sales eng',
  brief: 'Decide the setup flow and the SSO path for the new onboarding, and agree what an empty account shows.',
  lanes: [
    {
      id: 'goals',
      title: "Where we're headed",
      cards: [
        `<section data-card="c1" data-kind="goal">
<h3>Cut time-to-first-value</h3>
<p>New users reach a working dashboard in under 5 minutes, without a sales call or a support ticket.</p>
<dl><dt>owner</dt><dd>Product</dd><dt>agreed</dt><dd>session 1</dd></dl>
</section>`,
        `<section data-card="c2" data-kind="goal">
<h3>One path for every signup source</h3>
<p>Self-serve, invited teammates and SSO seats all land in the same first-run flow.</p>
<dl><dt>owner</dt><dd>Design</dd></dl>
</section>`,
        `<section data-card="c3" data-kind="metric" data-progress="68">
<h3>Activation rate</h3>
<data value="41">41%</data>
<small>target 60% · baseline last 90 days</small>
<p>A dashboard with at least one live data source within 7 days of signup.</p>
</section>`,
        `<section data-card="c4" data-kind="metric" data-progress="22">
<h3>Median time to first dashboard</h3>
<data value="23">23 min</data>
<small>target 5 min · p90 is 3.2 days</small>
<p>The long tail is mostly people waiting on data access.</p>
</section>`,
      ],
    },
    {
      id: 'decisions',
      title: 'Open decisions',
      cards: [
        `<section data-card="c5" data-kind="decision" data-status="open">
<h3>How do we collect setup data?</h3>
<p>We need the data source, team size and main use case before the first dashboard is useful.</p>
<ol>
<li data-votes="2">Long form up front<small>Everything on one page before the product loads</small></li>
<li data-votes="5">Progressive wizard<small>Three short steps, skippable, resumable later</small></li>
<li data-votes="1">Import from CSV<small>Fastest for teams that already have a spreadsheet</small></li>
</ol>
<dl><dt>decide by</dt><dd>end of session</dd></dl>
</section>`,
        `<section data-card="c6" data-kind="decision" data-status="open">
<h3>What does an empty account show?</h3>
<p>Today a new account opens on a blank canvas, and a lot of people bounce right there.</p>
<ol>
<li data-votes="4">Sample dashboard with demo data<small>Clearly labeled, one click to swap in real data</small></li>
<li data-votes="3">Template gallery<small>Pick a starting point by role</small></li>
<li data-votes="0">Keep the blank canvas<small>Add a short checklist in the sidebar</small></li>
</ol>
<dl><dt>decide by</dt><dd>session 3</dd></dl>
</section>`,
        `<section data-card="c7" data-kind="decision" data-status="open">
<h3>Do SSO seats get the wizard?</h3>
<p>SSO users are provisioned by an admin, so their workspace already exists.</p>
<ol>
<li data-votes="2">Full wizard<small>Same as self-serve, admin settings pre-filled</small></li>
<li data-votes="4">Short personal tour<small>Skip workspace setup, keep the personal steps</small></li>
</ol>
<dl><dt>decide by</dt><dd>end of session</dd></dl>
</section>`,
      ],
    },
    {
      id: 'risks',
      title: 'Risks',
      cards: [
        `<section data-card="c8" data-kind="risk" data-severity="high">
<h3>SSO users skip onboarding entirely</h3>
<p>About a third of seats arrive by SSO and never see onboarding, so a self-serve redesign misses them.</p>
<dl><dt>linked</dt><dd>c7</dd></dl>
</section>`,
        `<section data-card="c9" data-kind="risk" data-severity="high">
<h3>Data access is the real bottleneck</h3>
<p>Most of the 23 minutes is people waiting for credentials from their own IT team.</p>
<ul>
<li>Offer demo data so they can explore while they wait</li>
<li>Send a ready-made request email they can forward to IT</li>
</ul>
<dl><dt>raised by</dt><dd>Support</dd></dl>
</section>`,
        `<section data-card="c10" data-kind="risk" data-severity="medium">
<h3>Demo data gets mistaken for real data</h3>
<p>If sample numbers look too real, someone will screenshot them into a deck.</p>
<dl><dt>linked</dt><dd>c6</dd></dl>
</section>`,
      ],
    },
    {
      id: 'ideas',
      title: "Ideas we haven't sorted yet",
      cards: [
        `<section data-card="c11" data-kind="idea">
<h3>Invite a teammate as a setup step</h3>
<p>Teams with two or more active people in week one retain much better.</p>
</section>`,
        `<section data-card="c12" data-kind="idea">
<h3>Ask the role, not the company size</h3>
<p>Role predicts which dashboard people want far better than headcount does.</p>
</section>`,
        `<section data-card="c13" data-kind="note">
<h3>Live chat only in the first hour</h3>
<p>Support has capacity for a narrow window. Parked until session 3.</p>
</section>`,
      ],
    },
    {
      id: 'plan',
      title: 'Plan and actions',
      cards: [
        `<section data-card="c14" data-kind="action">
<h3>Draft the three wizard steps as wireframes</h3>
<dl><dt>owner</dt><dd>Design</dd><dt>due</dt><dd>before session 3</dd><dt>status</dt><dd>in progress</dd></dl>
</section>`,
        `<section data-card="c15" data-kind="action">
<h3>List what SSO admins already configure</h3>
<dl><dt>owner</dt><dd>Sales eng</dd><dt>due</dt><dd>next week</dd><dt>status</dt><dd>not started</dd></dl>
</section>`,
        `<section data-card="c16" data-kind="html">
<h3>Timeline</h3>
<svg viewBox="0 0 400 60" role="img" aria-label="Sessions 1 to 3, then build in July and roll out in August">
<line x1="10" y1="30" x2="390" y2="30" stroke="currentColor" stroke-width="2"/>
<circle cx="20" cy="30" r="6"/><circle cx="110" cy="30" r="8" fill="#f2b705"/><circle cx="200" cy="30" r="6"/><circle cx="290" cy="30" r="6"/><circle cx="380" cy="30" r="6"/>
<text x="20" y="55" font-size="11" text-anchor="middle">S1</text><text x="110" y="55" font-size="11" text-anchor="middle">S2 · now</text>
<text x="200" y="55" font-size="11" text-anchor="middle">S3</text><text x="290" y="55" font-size="11" text-anchor="middle">July</text>
<text x="380" y="55" font-size="11" text-anchor="end">Aug</text>
</svg>
</section>`,
      ],
    },
  ],
};

export const STARTER = {
  title: 'New huddle',
  subtitle: 'Add cards here, or ask your agent to.',
  brief: '',
  lanes: [
    {
      id: 'board',
      title: 'Board',
      cards: [
        `<section data-card="c1" data-kind="note">
<h3>Start here</h3>
<p>Hover a card and press Note to leave a note for the agent. Save writes the whole board, notes included, back into this file.</p>
</section>`,
      ],
    },
  ],
};
