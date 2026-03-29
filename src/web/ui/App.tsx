import { Route, Routes } from 'react-router-dom';
import { IssueDetail } from './components/IssueDetail.tsx';
import { IssueList } from './components/IssueList.tsx';
import { Layout } from './components/Layout.tsx';

function CreateIssuePlaceholder() {
  return <div className="p-6 text-gray-400">Create issue coming soon...</div>;
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<IssueList />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
        <Route path="/new" element={<CreateIssuePlaceholder />} />
      </Routes>
    </Layout>
  );
}
