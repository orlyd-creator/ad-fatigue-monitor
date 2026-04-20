export default function LeadsLoading() {
  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-pulse">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="h-9 w-32 bg-gray-200 rounded-lg" />
            <div className="h-4 w-64 bg-gray-100 rounded mt-2" />
          </div>
          <div className="h-10 w-[380px] bg-gray-100 rounded-xl" />
        </div>
        <div className="grid grid-cols-5 gap-4 mb-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="lv-card p-4 text-center">
              <div className="h-8 w-20 bg-gray-200 rounded mx-auto" />
              <div className="h-3 w-16 bg-gray-100 rounded mx-auto mt-2" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-4 mb-8">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="lv-card p-4">
              <div className="h-8 w-12 bg-gray-200 rounded" />
              <div className="h-3 w-20 bg-gray-100 rounded mt-2" />
            </div>
          ))}
        </div>
        <div className="lv-card p-6 mb-8"><div className="h-[300px] bg-gray-100 rounded-xl" /></div>
        <div className="lv-card p-6 mb-8"><div className="h-[320px] bg-gray-100 rounded-xl" /></div>
      </main>
    </div>
  );
}
