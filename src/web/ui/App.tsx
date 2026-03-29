import { Route, Routes } from 'react-router-dom';
import { IssueDetail } from './components/IssueDetail.tsx';
import { IssueList } from './components/IssueList.tsx';
import { Layout } from './components/Layout.tsx';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<IssueList />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
      </Routes>
    </Layout>
  );
}
