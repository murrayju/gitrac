export function search(notes, query) {
  return notes.filter((note) => note.text.includes(query));
}

export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize - 1);
}
