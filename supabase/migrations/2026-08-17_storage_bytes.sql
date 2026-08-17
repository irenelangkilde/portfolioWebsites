-- Running total of bytes a user has uploaded.
--
-- WHY A COUNTER RATHER THAN COUNTING ON DEMAND
--
-- Asset keys are namespaced by user, so usage could in principle be summed by listing that
-- prefix. But Netlify Blobs' list() returns keys, not sizes — getting sizes means one
-- metadata fetch per blob, on a path that runs every time somebody uploads an image. A
-- counter is one read.
--
-- ACCURACY, AND HOW IT COULD DRIFT
--
-- Keys are content-hashed, so re-uploading an identical file overwrites rather than adds.
-- The upload path checks whether the key already exists and only counts genuinely new
-- bytes; without that the counter would climb every time somebody re-uploaded the same
-- photo.
--
-- Nothing deletes assets today, so there is no decrement path. WHEN ONE IS ADDED IT MUST
-- DECREMENT THIS COLUMN, or the counter becomes a high-water mark and eventually locks
-- people out of storage they are not using.
alter table public.memberships
  add column if not exists storage_bytes bigint not null default 0;

comment on column public.memberships.storage_bytes is
  'Bytes of uploaded assets. Incremented by uploadPortfolioAsset for new keys only. Any future asset-deletion path must decrement it.';
