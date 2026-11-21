import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRelayHealth } from "@/hooks/useRelayHealth";
import { useAppContext } from "@/hooks/useAppContext";
import { LoginArea } from "@/components/auth/LoginArea";
import { RelaySelector } from "@/components/RelaySelector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuthor } from "@/hooks/useAuthor";
import { genUserName } from "@/lib/genUserName";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { User, Settings, MessageCircle, Wifi, WifiOff, Menu } from "lucide-react";

export function Navigation() {
  const location = useLocation();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { data: relayHealth, isStale, refetch: checkRelay } = useRelayHealth();
  const author = useAuthor(user?.pubkey);

  const metadata = author.data?.metadata;
  const displayName = metadata?.name || metadata?.display_name || (user ? genUserName(user.pubkey) : '');

  const relayName = config.relayUrl.replace('wss://', '').replace('ws://', '').split('/')[0];
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { to: '/', label: 'Home', active: location.pathname === '/' },
    { to: '/tribes', label: 'Tribes', active: location.pathname === '/tribes' },
    { to: '/village', label: 'Village', active: location.pathname.startsWith('/village') },
    ...(user ? [{ to: '/messages', label: 'Messages', active: location.pathname === '/messages' }] : []),
    { to: '/about', label: 'About', active: location.pathname === '/about' },
  ];

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-bold text-xl">
            <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              🏘️ Village Vibe
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  link.active ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {link.label}
              </Link>
            ))}

            {/* Relay Status Indicator - Clickable to switch relays */}
            <DropdownMenu onOpenChange={open => { if (open && isStale) void checkRelay(); }}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs px-2">
                  {relayHealth?.status === 'connected' ? (
                    <>
                      <Wifi className="h-3 w-3 text-green-600" />
                      <span className="hidden lg:inline text-green-600">{relayName}</span>
                    </>
                  ) : !relayHealth ? 'Checking relay…' : (
                    <>
                      <WifiOff className="h-3 w-3 text-red-600" />
                      <span className="hidden lg:inline text-red-600">Disconnected</span>
                    </>
                  )}
                  {relayHealth?.latency && relayHealth.latency > 1000 && (
                    <Badge variant="destructive" className="text-[10px] h-4 ml-1">Slow</Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <div className="p-2 space-y-2">
                  <div className="text-xs font-semibold">Primary Relay</div>
                  <RelaySelector className="w-full" />
                  {relayHealth && (
                    <div className="text-[10px] text-muted-foreground space-y-1 pt-2 border-t">
                      <div>Status: {relayHealth.status}</div>
                      {relayHealth.latency && <div>Latency: {relayHealth.latency}ms</div>}
                    </div>
                  )}

                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* User Area */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Mobile menu: the desktop links above are hidden below md */}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle>Village Vibe</SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1">
                  {navLinks.map(link => (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => setMenuOpen(false)}
                      className={`rounded-md px-3 py-2 text-base font-medium hover:bg-muted ${
                        link.active ? 'bg-muted text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
                <div className="mt-6 space-y-2 border-t pt-4">
                  <div className="text-xs font-semibold">Primary relay</div>
                  <RelaySelector className="w-full" />
                </div>
              </SheetContent>
            </Sheet>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={metadata?.picture} alt={displayName} />
                      <AvatarFallback>
                        {displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                  <div className="flex items-center justify-start gap-2 p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={metadata?.picture} alt={displayName} />
                      <AvatarFallback>
                        {displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{displayName}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user.pubkey.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to={`/profile/${user.pubkey}`} className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/messages" className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4" />
                      Messages
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings/profile" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="p-2">
                    <LoginArea className="w-full" />
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <LoginArea className="max-w-48" />
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}