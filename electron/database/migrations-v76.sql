-- Branch isolation harden: stamp legacy NULL recipe/production rows onto active till branch
UPDATE recipe_profiles
SET branch_id = COALESCE(
  (SELECT branch_id FROM shop_settings WHERE id = 1),
  1
)
WHERE branch_id IS NULL;

UPDATE production_batches
SET branch_id = COALESCE(
  (SELECT r.branch_id FROM recipe_profiles r WHERE r.id = production_batches.recipe_profile_id),
  (SELECT branch_id FROM shop_settings WHERE id = 1),
  1
)
WHERE branch_id IS NULL;

UPDATE recipe_activity_log
SET branch_id = COALESCE(
  (SELECT branch_id FROM shop_settings WHERE id = 1),
  1
)
WHERE branch_id IS NULL;
