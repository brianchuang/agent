import { auth, signIn, signOut } from "../../lib/auth";
import { getObservabilityStore } from "@agent/observability";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const session = await auth();
  
  if (!session?.user?.id) {
      return (
          <div className="p-8">
            <h1 className="text-2xl font-bold mb-4">Settings</h1>
            <p>Please sign in to manage connections.</p>
            <form
              action={async () => {
                "use server";
                await signIn("google");
              }}
            >
              <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded mt-4">
                Sign in with Google
              </button>
            </form>
          </div>
      );
  }

  const store = getObservabilityStore();
  const googleConnection = await store.getConnection(session.user.id, 'google');
  const isConnected = !!googleConnection;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="border rounded-lg p-6 max-w-md">
        <h2 className="text-xl font-semibold mb-4">Integrations</h2>
        
        <div className="flex items-center justify-between py-4 border-b">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="text-xl">📅</span>
                </div>
                <div>
                    <div className="font-medium">Google Calendar</div>
                    <div className="text-sm text-gray-500">
                        {isConnected ? "Connected" : "Not connected"}
                    </div>
                </div>
            </div>
            
            {isConnected ? (
                <div className="flex items-center gap-4">
                    <span className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded-full cursor-default">
                        Connected
                    </span>
                    <form
                        action={async () => {
                            "use server";
                            const storeServer = getObservabilityStore(); // Re-fetch to ensure scope
                            if (session?.user?.id) {
                                await storeServer.deleteConnection(session.user.id, 'google');
                            }
                            redirect("/settings");
                        }}
                    >
                        <button 
                            type="submit" 
                            className="text-sm text-red-600 hover:text-red-800 underline decoration-red-200 underline-offset-4"
                        >
                            Disconnect
                        </button>
                    </form>
                </div>
            ) : (
                <form
                  action={async () => {
                    "use server";
                    await signIn("google");
                  }}
                >
                  <button type="submit" className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 text-sm font-medium transition-colors">
                    Connect
                  </button>
                </form>
            )}
        </div>
      </div>

      <div className="mt-8">
        <form
          action={async () => {
            "use server";
            await signOut();
          }}
        >
          <button type="submit" className="text-red-600 border border-red-200 px-4 py-2 rounded hover:bg-red-50 text-sm">
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );
}
