import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount element.')

ReactDOM.render(<App />, root)

void import('./main')
