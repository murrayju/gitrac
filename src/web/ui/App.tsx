import { Route, Routes, useParams } from 'react-router-dom';
import { DraftList } from './components/DraftList.tsx';
import { IssueDetail } from './components/IssueDetail.tsx';
import { IssueList } from './components/IssueList.tsx';
import { Layout } from './components/Layout.tsx';

function IssueDetailWrapper() {
  const { id } = useParams<{ id: string }>();
  return <IssueDetail key={id} />;
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<IssueList />} />
        <Route path="/issues/:id" element={<IssueDetailWrapper />} />
        <Route path="/drafts" element={<DraftList />} />
      </Routes>
    </Layout>
  );
}
