import { Route, Routes, useParams } from 'react-router-dom';
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
      </Routes>
    </Layout>
  );
}
