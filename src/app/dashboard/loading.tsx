export default function DashboardLoading() {
  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-pulse">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="h-9 w-40 bg-gray-200 rounded-lg" />
            <div className="h-4 w-56 bg-gray-100 rounded mt-2" />
          </div>
          <div className="h-10 w-[300px] bg-gray-100 rounded-xl" />
        </div>
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="lv-card p-5">
              <div className="h-3 w-20 bg-gray-100 rounded" />
              <div className="h-7 w-24 bg-gray-200 rounded mt-2" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="lv-card p-6 h-[200px] bg-gray-50 rounded-2xl" />
          ))}
        </div>
      </main>
    </div>
  );
}
