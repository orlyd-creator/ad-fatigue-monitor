export default function AlertsLoading() {
  return (
    <div className="min-h-screen">
      <main className="max-w-3xl mx-auto px-6 py-8 animate-pulse">
        <div className="mb-8">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="h-4 w-72 bg-gray-100 rounded mt-2" />
        </div>
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="lv-card p-5 h-[100px] bg-gray-50 rounded-2xl" />
          ))}
        </div>
      </main>
    </div>
  );
}
