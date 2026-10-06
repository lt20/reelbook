// Reelbook — app configuration.
// Themes and groups are shared with the skill (skill/exercise-reel/SKILL.md keeps the same list).
window.REELBOOK = {
  // The hosted backend offered by the Reelbook maintainers. Leave url empty to hide the option.
  hosted: {
    name: 'Reelbook hosted',
    url: 'https://xgarsygrkfnfyvxkcxdm.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnYXJzeWdya2ZuZnl2eGtjeGRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODk1NjIsImV4cCI6MjEwNjg2NTU2Mn0.ThclH-X2LC4MURxf27jFsjYHXzohJ8HYrscbd8E8U3I',
    blurb: 'Free for now. No setup, your data stays private to your account.'
  },
  themes: [
    { id: 'strength', title: 'Strength', sub: 'Weights, bodyweight, bands. Movements and circuits.',
      groups: ['Shoulders', 'Arms', 'Abs', 'Back', 'Core', 'Hips', 'Knees', 'Legs', 'Mobility'] },
    { id: 'yoga', title: 'Yoga & stretching', sub: 'Poses, stretches, breathing, flows.',
      groups: ['Back', 'Hips', 'Shoulders', 'Legs', 'Breathing', 'Flows'] },
    { id: 'fight', title: 'Fight techniques', sub: 'Striking, defense, clinch, footwork.',
      groups: ['Punches', 'Kicks & knees', 'Defense', 'Clinch & grappling', 'Footwork', 'Bag & pads'] }
  ],
  repo: 'https://github.com/lt20/reelbook'
};
