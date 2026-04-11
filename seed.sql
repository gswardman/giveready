-- GiveReady Seed Data
-- Real nonprofits, real numbers, real impact

-- ============================================
-- CAUSES
-- ============================================

INSERT OR IGNORE INTO causes (id, name, description) VALUES
  ('youth-empowerment', 'Youth Empowerment', 'Programmes that build confidence, skills, and opportunity for young people'),
  ('music-education', 'Music Education', 'Teaching music production, performance, and music business skills'),
  ('adventure-travel', 'Adventure & Travel', 'Funding travel, exploration, and real-world experience for young people'),
  ('mental-health', 'Mental Health', 'Supporting young people with anxiety, trauma, isolation, and mental health challenges'),
  ('surf-therapy', 'Surf Therapy', 'Using surfing as a therapeutic intervention for wellbeing'),
  ('entrepreneurship', 'Entrepreneurship', 'Teaching business skills, creative economy, and self-employment'),
  ('poverty-reduction', 'Poverty Reduction', 'Expanding economic pathways for people in low-income communities'),
  ('creative-arts', 'Creative Arts', 'Music, visual arts, film, and creative expression programmes'),
  ('education', 'Education', 'Formal and informal education, skills training, and capacity building'),
  ('community-development', 'Community Development', 'Strengthening local communities through programmes and infrastructure');

-- ============================================
-- NONPROFITS
-- ============================================

-- Bridges for Music
INSERT OR IGNORE INTO nonprofits (
  id, slug, name, tagline, mission, description, website, donation_url,
  country, city, region, founded_year, annual_budget_usd, budget_year,
  team_size, beneficiaries_per_year, contact_email, verified, ghd_aligned
) VALUES (
  'bridges-for-music',
  'bridges-for-music',
  'Bridges for Music',
  'Harnessing the power of music for change',
  'Bridges for Music empowers youth in underserved communities through music education, entrepreneurship training, and mindfulness — creating pathways to the creative economy and sustainable livelihoods.',
  'Founded in 2012, Bridges for Music operates a 1,000 sqm modern facility in Langa, one of Cape Town''s oldest and most densely populated townships. The Academy features world-class recording studios, computer rooms, and DJ rooms. Each year over 250 students (called co-creators) complete courses in music production, DJing and performance, music business and entrepreneurship, and meditation. The Industry Access employment programme creates around 250 job placements annually. Graduates enter South Africa''s growing creative economy with real skills, professional networks, and income-generating capability. Bridges for Music has spent over a decade proving that music education is a viable pathway out of poverty in township communities.',
  'https://bridgesformusic.org',
  'https://bridgesformusic.org/donate',
  'South Africa',
  'Cape Town',
  'Western Cape',
  2012,
  500000,
  2025,
  25,
  500,
  'info@bridgesformusic.org',
  1,
  1
);

-- The Wave Project
INSERT OR IGNORE INTO nonprofits (
  id, slug, name, tagline, mission, description, website, donation_url,
  country, city, region, founded_year, annual_budget_usd, budget_year,
  team_size, beneficiaries_per_year, contact_email, verified, ghd_aligned
) VALUES (
  'the-wave-project',
  'the-wave-project',
  'The Wave Project',
  'Surf therapy changing young lives',
  'The Wave Project uses surfing to improve the mental health and wellbeing of children and young people facing challenges including anxiety, trauma, isolation, and low self-esteem.',
  'Founded by Joe Taylor in 2010, The Wave Project was the first charity in the world to offer surfing on prescription to children with mental health needs. Operating across 32 locations in the UK, the charity runs volunteer-led six-week surf therapy courses for young people referred by schools, social workers, GPs, and mental health services. Over 5,000 young people have completed the programme. Independent research shows 95% of participants report improved confidence and 98% of referrers say surf therapy had a positive impact. What started with a small NHS grant for 20 young people has become the global model for surf therapy as a clinical intervention.',
  'https://www.waveproject.co.uk',
  'https://www.waveproject.co.uk/donate',
  'United Kingdom',
  'Newquay',
  'Cornwall',
  2010,
  800000,
  2025,
  30,
  1000,
  'info@waveproject.co.uk',
  1,
  0
);

-- Finn Wardman World Explorer Fund
INSERT OR IGNORE INTO nonprofits (
  id, slug, name, tagline, mission, description, website, donation_url, usdc_wallet,
  country, city, region, founded_year, annual_budget_usd, budget_year,
  team_size, beneficiaries_per_year, contact_email, verified, ghd_aligned
) VALUES (
  'finn-wardman-wef',
  'finn-wardman-world-explorer-fund',
  'Finn Wardman World Explorer Fund',
  'Changing lives, one dream at a time',
  'The Finn Wardman World Explorer Fund sends young people into the world through adventure grants — funding travel, exploration, and experiences that build confidence, independence, and perspective.',
  'The WEF was established in memory of Finn Wardman, who died in 2023 at age 20. Finn was an avid freeride skier in Verbier, a surfer, and someone who lived fully in every moment. The fund honours that spirit by giving other young people the chance to explore the world. Based in Bermuda with an endowment at the Bermuda Community Foundation, the WEF awards grants to young people for adventure travel and cultural exploration. Past grantees have used funds for international travel, outdoor education, and immersive experiences that changed their trajectory. The fund is run by Geordie Wardman, Finn''s father, who also writes about adventure, presence, and grief on the WEF blog.',
  'https://www.finnwardman.com',
  'https://www.finnwardman.com/donate',
  'J4F3RwWiCnAvyeMqnrxMb7RC8CVg2kk8VyPFfzbfn3CH',
  'Bermuda',
  'Hamilton',
  'Bermuda',
  2023,
  50000,
  2025,
  3,
  10,
  'geordie@finnwardman.com',
  1,
  0
);

-- City Kids Surfing
INSERT OR IGNORE INTO nonprofits (
  id, slug, name, tagline, mission, description, website, donation_url,
  country, city, region, founded_year, annual_budget_usd, budget_year,
  team_size, beneficiaries_per_year, contact_email, verified, ghd_aligned
) VALUES (
  'city-kids-surfing',
  'city-kids-surfing',
  'City Kids Surfing',
  'Getting city kids into the ocean',
  'City Kids Surfing takes young people from urban environments into the sea — using surfing as a tool for building confidence, resilience, and mental wellbeing.',
  'Founded in 2017 by Joe Taylor, City Kids Surfing runs an annual surf trip and year-round mentoring programme for around 30 young people from urban communities. The charity uses surf therapy and outdoor adventure to support youth facing challenges with mental health, confidence, and social isolation. Registered with the UK Charity Commission (1182899), City Kids Surfing is a small, hands-on charity where every participant gets direct, sustained support. Joe Taylor also founded The Wave Project, the world''s first surf-therapy-on-prescription charity, and brings that clinical evidence base to City Kids'' more intimate, mentorship-driven model.',
  'https://getcitykidssurfing.com',
  'https://getcitykidssurfing.com/donate',
  'United Kingdom',
  'London',
  'England',
  2017,
  50000,
  2025,
  5,
  30,
  'joe@getcitykidssurfing.com',
  1,
  1
);

-- ============================================
-- CAUSE MAPPINGS
-- ============================================

-- Bridges for Music
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES
  ('bridges-for-music', 'youth-empowerment'),
  ('bridges-for-music', 'music-education'),
  ('bridges-for-music', 'entrepreneurship'),
  ('bridges-for-music', 'poverty-reduction'),
  ('bridges-for-music', 'creative-arts'),
  ('bridges-for-music', 'community-development');

-- The Wave Project
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES
  ('the-wave-project', 'youth-empowerment'),
  ('the-wave-project', 'mental-health'),
  ('the-wave-project', 'surf-therapy'),
  ('the-wave-project', 'education');

-- City Kids Surfing
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES
  ('city-kids-surfing', 'youth-empowerment'),
  ('city-kids-surfing', 'mental-health'),
  ('city-kids-surfing', 'surf-therapy');

-- WEF
INSERT OR IGNORE INTO nonprofit_causes (nonprofit_id, cause_id) VALUES
  ('finn-wardman-wef', 'youth-empowerment'),
  ('finn-wardman-wef', 'adventure-travel'),
  ('finn-wardman-wef', 'education');

-- ============================================
-- PROGRAMS
-- ============================================

-- Bridges for Music
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES
  ('bfm-academy', 'bridges-for-music', 'Bridges Academy', 'Full curriculum in music production, DJing, performance, music business, entrepreneurship, and meditation. Students complete courses over 6-12 months with access to professional recording studios and equipment.', 250, 'Langa, Cape Town'),
  ('bfm-industry-access', 'bridges-for-music', 'Industry Access Programme', 'Employment placement programme connecting academy graduates with jobs in South Africa''s creative and music industry. Provides mentorship, professional networking, and career support.', 250, 'Cape Town metro');

-- The Wave Project
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES
  ('wp-surf-therapy', 'the-wave-project', 'Surf Therapy Course', 'Six-week volunteer-led surfing programme for young people referred by schools, GPs, social workers, and mental health services. Participants receive free wetsuits, boards, and qualified instruction.', 800, '32 locations across the UK'),
  ('wp-surf-club', 'the-wave-project', 'Surf Club', 'Ongoing weekly surf sessions for graduates of the main programme, providing continued community, physical activity, and peer support.', 400, '32 locations across the UK');

-- City Kids Surfing
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES
  ('cks-surf-trip', 'city-kids-surfing', 'Annual Surf Trip', 'Multi-day residential surf trip taking young people from the city to the coast. Participants learn to surf, spend time in nature, and build relationships with mentors and peers.', 30, 'UK coast'),
  ('cks-mentoring', 'city-kids-surfing', 'Mentoring Programme', 'Year-round one-to-one mentoring for young people, providing ongoing support, goal-setting, and connection between surf trips.', 30, 'London');

-- WEF
INSERT OR IGNORE INTO programs (id, nonprofit_id, name, description, beneficiaries_per_year, location) VALUES
  ('wef-adventure-grants', 'finn-wardman-wef', 'Adventure Grants', 'Direct grants to young people for international travel, outdoor education, and cultural exploration experiences. Applications reviewed by the WEF board with priority given to proposals that demonstrate genuine curiosity and a spirit of adventure.', 10, 'Global');

-- ============================================
-- IMPACT METRICS
-- ============================================

-- Bridges for Music
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('bfm-students', 'bridges-for-music', 'Students trained', '250', 'students', 'annual', 2025),
  ('bfm-placements', 'bridges-for-music', 'Job placements through Industry Access', '250', 'placements', 'annual', 2025),
  ('bfm-years', 'bridges-for-music', 'Years operating in Langa', '13', 'years', 'cumulative', 2025),
  ('bfm-facility', 'bridges-for-music', 'Academy facility size', '1000', 'sqm', 'current', 2025);

-- The Wave Project
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('wp-total', 'the-wave-project', 'Young people completed programme', '5000', 'young people', 'cumulative', 2025),
  ('wp-locations', 'the-wave-project', 'UK locations', '32', 'locations', 'current', 2025),
  ('wp-confidence', 'the-wave-project', 'Participants reporting improved confidence', '95', 'percent', 'annual', 2025),
  ('wp-referrer-satisfaction', 'the-wave-project', 'Referrers reporting positive impact', '98', 'percent', 'annual', 2025);

-- City Kids Surfing
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('cks-kids', 'city-kids-surfing', 'Young people supported annually', '30', 'young people', 'annual', 2025),
  ('cks-years', 'city-kids-surfing', 'Years operating', '8', 'years', 'cumulative', 2025);

-- WEF
INSERT OR IGNORE INTO impact_metrics (id, nonprofit_id, name, value, unit, period, year) VALUES
  ('wef-grantees', 'finn-wardman-wef', 'Adventure grants awarded', '5', 'grants', 'annual', 2025),
  ('wef-raised', 'finn-wardman-wef', 'Total funds raised', '155000', 'USD', 'cumulative', 2025);

-- ============================================
-- REGISTRATIONS
-- ============================================

INSERT OR IGNORE INTO registrations (id, nonprofit_id, country, type, registration_number) VALUES
  ('bfm-uk', 'bridges-for-music', 'United Kingdom', 'Registered Charity', '1154170'),
  ('bfm-us', 'bridges-for-music', 'United States', '501(c)(3)', NULL),
  ('bfm-za', 'bridges-for-music', 'South Africa', 'NPC', '2015/002748/08'),
  ('wp-uk', 'the-wave-project', 'United Kingdom', 'Registered Charity', NULL),
  ('cks-uk', 'city-kids-surfing', 'United Kingdom', 'Registered Charity', '1182899'),
  ('wef-bm', 'finn-wardman-wef', 'Bermuda', 'Endowed Fund (via Bermuda Community Foundation)', NULL);
