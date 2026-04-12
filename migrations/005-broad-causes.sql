-- GiveReady — Expand cause taxonomy for wide infrastructure
-- Agent layer is broad (any nonprofit, any cause)
-- Human layer is narrow (youth nonprofits prove the model)
-- Run: npx wrangler d1 execute giveready-db --remote --file=migrations/005-broad-causes.sql

INSERT OR IGNORE INTO causes (id, name, description) VALUES
  ('environment', 'Environment', 'Conservation, climate action, and environmental protection'),
  ('health', 'Health', 'Healthcare, disease prevention, and public health programmes'),
  ('animals', 'Animals', 'Animal welfare, rescue, and wildlife protection'),
  ('housing', 'Housing', 'Affordable housing, homelessness prevention, and shelter programmes'),
  ('food-security', 'Food Security', 'Food banks, hunger relief, and nutrition programmes'),
  ('disability', 'Disability', 'Support, advocacy, and services for people with disabilities'),
  ('veterans', 'Veterans', 'Services and support for military veterans and their families'),
  ('racial-justice', 'Racial Justice', 'Anti-racism, equity, and racial justice initiatives'),
  ('immigration', 'Immigration', 'Immigrant services, refugee support, and integration programmes'),
  ('lgbtq', 'LGBTQ+', 'Support, advocacy, and services for LGBTQ+ communities'),
  ('science-research', 'Science & Research', 'Scientific research, STEM programmes, and academic advancement'),
  ('religion', 'Religion & Faith', 'Faith-based community organisations and religious programmes'),
  ('gender-equality', 'Gender Equality', 'Women-led organisations, gender equity, and empowerment programmes'),
  ('refugees', 'Refugees', 'Refugee resettlement, protection, and integration services'),
  ('sports-recreation', 'Sports & Recreation', 'Athletics, sports programmes, and recreational activities'),
  ('legal-justice', 'Legal & Justice', 'Legal aid, voting rights, free press, and justice reform'),
  ('seniors', 'Seniors', 'Services and support for older adults'),
  ('water-sanitation', 'Water & Sanitation', 'Clean water access, sanitation, and hygiene programmes');
