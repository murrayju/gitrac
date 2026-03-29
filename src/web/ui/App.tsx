import { Route, Routes } from 'react-router-dom';
import { IssueList } from './components/IssueList.tsx';
import { Layout } from './components/Layout.tsx';

function IssueDetailPlaceholder() {
  return <div className="p-6 text-gray-400">Issue detail coming soon...</div>;
}

function CreateIssuePlaceholder() {
  return <div className="p-6 text-gray-400">Create issue coming soon...</div>;
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<IssueList />} />
        <Route path="/issues/:id" element={<IssueDetailPlaceholder />} />
        <Route path="/new" element={<CreateIssuePlaceholder />} />
      </Routes>
    </Layout>
  );
}
