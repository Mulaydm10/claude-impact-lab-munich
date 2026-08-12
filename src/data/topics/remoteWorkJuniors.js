/**
 * Fixed asOf date so heuristic recency scoring is reproducible regardless of
 * when this is demoed — never Date.now() here.
 */
export const remoteWorkJuniors = {
  id: 'remote-work-juniors',
  title: 'Is remote work bad for junior employees’ development?',
  matchKeywords: ['remote', 'junior', 'onboarding', 'wfh', 'office'],
  freshnessWindowDays: 1095,
  asOf: '2026-08-01',

  clarifyingQuestions: [
    {
      id: 'angle',
      prompt: 'Whose angle are you researching this from?',
      options: [
        { id: 'ic', label: 'Individual contributor' },
        { id: 'manager', label: 'Manager' },
      ],
    },
    {
      id: 'measure',
      prompt: 'Which measure of development matters most here?',
      options: [
        { id: 'skill_growth', label: 'Skill growth' },
        { id: 'career_progression', label: 'Career progression' },
      ],
    },
  ],

  sources: [
    {
      id: 'longitudinal-study',
      title: 'Remote Work and Early-Career Skill Development: A 2025 Longitudinal Study',
      publisher: 'Journal of Organizational Behavior',
      domain: 'joborgbehavior.org',
      domainTier: 1,
      type: 'primary',
      publishedDate: '2025-11-01',
      url: 'https://example.com/longitudinal-study',
    },
    {
      id: 'state-of-remote-report',
      title: 'State of Remote Work 2026',
      publisher: 'Institute for Labor Futures',
      domain: 'laborfutures.org',
      domainTier: 1,
      type: 'primary',
      publishedDate: '2026-01-15',
      url: 'https://example.com/state-of-remote-report',
    },
    {
      id: 'junior-retention-survey',
      title: 'Early-Career Retention Survey, Member Companies',
      publisher: 'National HR Trade Association',
      domain: 'hrtradeassoc.org',
      domainTier: 2,
      type: 'secondary',
      publishedDate: '2022-05-01',
      url: 'https://example.com/junior-retention-survey',
    },
    {
      id: 'vendor-blog',
      title: 'Why Junior Talent Thrives In-Office',
      publisher: 'DeskShare Coworking',
      domain: 'deskshare.example.com/blog',
      domainTier: 3,
      type: 'marketing',
      publishedDate: '2026-03-01',
      url: 'https://example.com/vendor-blog',
    },
    {
      id: 'coworking-press-release',
      title: 'New Data: Remote Juniors Twice as Likely to Quit',
      publisher: 'HubSpace Coworking (press release)',
      domain: 'hubspace.example.com',
      domainTier: 3,
      type: 'press_release',
      publishedDate: '2026-02-01',
      conflictOfInterest: true,
      fundedBy: 'HubSpace Coworking',
      url: 'https://example.com/coworking-press-release',
    },
    {
      id: 'forum-thread',
      title: 'Anyone else notice remote juniors struggle more?',
      publisher: 'DevTalk Forums',
      domain: 'devtalk.example.com',
      domainTier: 3,
      type: 'anecdotal',
      publishedDate: '2018-01-01',
      url: 'https://example.com/forum-thread',
    },
  ],

  claims: [
    {
      id: 'c1', order: 1, sourceId: 'longitudinal-study', kind: 'stat', visibleWhen: null,
      text: 'A 2025 longitudinal workplace study found remote junior employees report slower informal feedback loops than in-office peers.',
    },
    {
      id: 'c2', order: 2, sourceId: 'state-of-remote-report', kind: 'stat', visibleWhen: null,
      text: 'An independent labor-research report found no significant gap in six-month technical skill assessments between remote and in-office juniors.',
    },
    {
      id: 'c3a', order: 3, sourceId: 'longitudinal-study', kind: 'argument', visibleWhen: { angle: 'ic' },
      text: 'Individual contributors in the study said they wanted more proactive check-ins from managers, not more time in a physical office.',
    },
    {
      id: 'c3b', order: 3, sourceId: 'state-of-remote-report', kind: 'argument', visibleWhen: { angle: 'manager' },
      text: 'Managers in the report said scheduled 1:1s mattered more for a junior’s perceived growth than physical location.',
    },
    {
      id: 'c4', order: 4, sourceId: 'junior-retention-survey', kind: 'stat', visibleWhen: null,
      text: 'A trade-association survey of member companies found 38% of managers rate remote juniors as "harder to mentor."',
    },
    {
      id: 'c5', order: 5, sourceId: 'vendor-blog', kind: 'stat', visibleWhen: null,
      text: 'A coworking-space vendor’s blog claims onboarding is "70% faster" for in-office juniors — no methodology is disclosed.',
    },
    {
      id: 'c6', order: 6, sourceId: 'coworking-press-release', kind: 'stat', visibleWhen: null,
      text: 'A coworking operator’s press release states remote juniors are "twice as likely to quit within a year."',
    },
    {
      id: 'c7', order: 7, sourceId: 'coworking-press-release', kind: 'argument', visibleWhen: null,
      text: 'The same press release attributes the attrition to "isolation and lack of visibility," without citing underlying data.',
    },
    {
      id: 'c8a', order: 8, sourceId: 'forum-thread', kind: 'context', visibleWhen: { measure: 'skill_growth' },
      text: 'An anonymous developer-forum thread claims remote juniors "never really learn the codebase" — no data given.',
    },
    {
      id: 'c8b', order: 8, sourceId: 'forum-thread', kind: 'context', visibleWhen: { measure: 'career_progression' },
      text: 'The same forum thread claims remote juniors "get passed over for promotion" more often — an anecdote, not a study.',
    },
  ],
};
