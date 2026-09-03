-- Two things the operator asked for that the schema had no room to hold.
--
-- 1. **Where to look, told apart.** A category rule had one list of words and a set of checkboxes
--    saying which text to read them in. That can express "the word DTF appears somewhere", but not
--    the thing actually wanted: *their website sells embroidery* AND *their Instagram calls itself a
--    clothing brand* → Fashion › Apparel. Those are two different questions about two different
--    sources, and one shared word list cannot ask both. Splitting them into their own groups is what
--    lets a rule relate a website to an Instagram account instead of merely searching both.
--
--    `require_all` is what turns the groups from alternatives into a conjunction. Default false, so
--    every rule written before this keeps behaving exactly as it did.
--
-- 2. **What an import is for.** `import_batches` recorded what a file contained and nothing about
--    what should happen to it. So every import did the same thing to every file, and the operator
--    had no way to say "this one is a list of apparel brands — read their sites, sort them, and
--    then go and get their Instagram". The plan is written down at the moment it is chosen, and read
--    back afterwards, so a file's detail page can say what it was told to do rather than guessing
--    from what happened to exist by the time somebody looked.

alter table public.category_rules
  add column website_any_of text[] not null default '{}',
  add column instagram_any_of text[] not null default '{}',
  add column require_all boolean not null default false;

comment on column public.category_rules.website_any_of is
  'Words to look for on their own website only — page text and web address. Separate from any_of so a rule can require something of the website and something else of the Instagram account.';
comment on column public.category_rules.instagram_any_of is
  'Words to look for on their Instagram only — bio, the category Instagram publishes, and the handle.';
comment on column public.category_rules.require_all is
  'false: the rule fires when ANY filled-in group matches. true: EVERY filled-in group must match, which is how one rule ties a website to an Instagram account. A group whose source was never fetched cannot match, so a require_all rule stays silent about a business nobody has looked up rather than treating missing as a miss.';

-- Null for every batch imported before this existed. Read as "no plan was recorded", which is the
-- truth about them, rather than defaulting to a plan they were never given.
alter table public.import_batches
  add column plan jsonb;

comment on column public.import_batches.plan is
  'What the operator chose to have done with this file, decided before the import ran: {analyseWebsites, applyCategories, instagram, note}. Meta ads is deliberately absent — it is picked per business by hand and never as part of a batch.';
