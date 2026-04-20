export default function Loading() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-pulse">
      <div className="mb-8">
        <div className="h-3 w-24 bg-gray-200 rounded mb-2" />
        <div className="h-8 w-48 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-72 bg-gray-200 rounded" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="lv-card p-6 flex flex-col gap-2">
            <div className="h-3 w-20 bg-gray-200 rounded" />
            <div className="h-8 w-24 bg-gray-200 rounded" />
            <div className="h-3 w-28 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      <div className="lv-card p-6 mb-8">
        <div className="h-4 w-40 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-60 bg-gray-200 rounded mb-4" />
        <div className="h-64 bg-gray-100 rounded" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="lv-card p-6">
            <div className="h-3 w-32 bg-gray-200 rounded mb-3" />
            <div className="flex gap-4">
              <div className="w-20 h-20 bg-gray-100 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-full bg-gray-200 rounded" />
                <div className="h-3 w-2/3 bg-gray-200 rounded" />
                <div className="h-3 w-1/2 bg-gray-200 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
