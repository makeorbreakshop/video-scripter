'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { DiscoverySearchInterface } from './discovery-search-interface';
import { 
  Search, 
  RefreshCw,
  Settings,
  Zap,
  Shield,
  Target
} from 'lucide-react';

export function DiscoverySettings() {
  const [pseQuota, setPseQuota] = useState({ used: 0, remaining: 100, total: 100 });
  const [settings, setSettings] = useState({
    autoApproval: false,
    minSubscribers: 5000,
    minVideos: 10,
    minAvgViews: 1000,
    googlePSEEnabled: true,
    featuredChannelsEnabled: true,
    shelvesEnabled: true,
    commentsEnabled: false,
    subscriptionsEnabled: false,
    collaborationsEnabled: true
  });

  useEffect(() => {
    loadPseQuota();
    loadSettings();
  }, []);

  const loadPseQuota = async () => {
    try {
      const response = await fetch('/api/google-pse/quota');
      if (response.ok) {
        const data = await response.json();
        setPseQuota(data.quota);
      }
    } catch (error) {
      console.error('Error loading PSE quota:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/youtube/discovery/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings({ ...settings, ...data.settings });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      const response = await fetch('/api/youtube/discovery/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });

      if (response.ok) {
        alert('Settings saved successfully!');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings');
    }
  };

  return (
    <div className="space-y-6">
      {/* Google PSE Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Google PSE Configuration
          </CardTitle>
          <CardDescription>
            Configure Google Programmable Search Engine settings and monitor quota
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quota Status */}
          <div className="p-4 border rounded-lg bg-background">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold">Daily Quota Status</h4>
                <p className="text-sm text-muted-foreground">
                  Resets at midnight PT
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadPseQuota}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-2xl font-bold">
                  {pseQuota.remaining}
                </div>
                <div className="text-sm text-muted-foreground">
                  Searches remaining
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-600">
                  {pseQuota.used}
                </div>
                <div className="text-sm text-muted-foreground">
                  Searches used today
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    pseQuota.used / pseQuota.total > 0.8 ? 'bg-red-500' :
                    pseQuota.used / pseQuota.total > 0.6 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${(pseQuota.used / pseQuota.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {((pseQuota.used / pseQuota.total) * 100).toFixed(1)}% used
              </p>
            </div>
          </div>

          {/* PSE Settings */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="google-pse">Enable Google PSE Discovery</Label>
                <p className="text-sm text-muted-foreground">
                  Use Google search to find YouTube channels (100 free searches/day)
                </p>
              </div>
              <Switch
                id="google-pse"
                checked={settings.googlePSEEnabled}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, googlePSEEnabled: checked })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discovery Methods */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Discovery Methods
          </CardTitle>
          <CardDescription>
            Enable or disable specific discovery methods
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Featured Channels</Label>
                <p className="text-sm text-muted-foreground">
                  Discover from channel featured sections
                </p>
              </div>
              <Switch
                checked={settings.featuredChannelsEnabled}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, featuredChannelsEnabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Channel Shelves</Label>
                <p className="text-sm text-muted-foreground">
                  Discover from channel shelf sections
                </p>
              </div>
              <Switch
                checked={settings.shelvesEnabled}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, shelvesEnabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Comments Analysis</Label>
                <p className="text-sm text-muted-foreground">
                  Find channels from video comments
                </p>
              </div>
              <Switch
                checked={settings.commentsEnabled}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, commentsEnabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Collaborations</Label>
                <p className="text-sm text-muted-foreground">
                  Discover collaborative channels
                </p>
              </div>
              <Switch
                checked={settings.collaborationsEnabled}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, collaborationsEnabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Subscriptions</Label>
                <p className="text-sm text-muted-foreground">
                  Requires OAuth authentication
                </p>
              </div>
              <Switch
                checked={settings.subscriptionsEnabled}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, subscriptionsEnabled: checked })
                }
                disabled
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Validation Criteria */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Validation Criteria
          </CardTitle>
          <CardDescription>
            Set minimum requirements for discovered channels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min-subscribers">Minimum Subscribers</Label>
              <Input
                id="min-subscribers"
                type="number"
                value={settings.minSubscribers}
                onChange={(e) => 
                  setSettings({ ...settings, minSubscribers: parseInt(e.target.value) || 0 })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="min-videos">Minimum Videos</Label>
              <Input
                id="min-videos"
                type="number"
                value={settings.minVideos}
                onChange={(e) => 
                  setSettings({ ...settings, minVideos: parseInt(e.target.value) || 0 })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="min-avg-views">Minimum Avg Views</Label>
              <Input
                id="min-avg-views"
                type="number"
                value={settings.minAvgViews}
                onChange={(e) => 
                  setSettings({ ...settings, minAvgViews: parseInt(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="auto-approval">Auto-Approval</Label>
              <p className="text-sm text-muted-foreground">
                Automatically approve channels that meet all criteria
              </p>
            </div>
            <Switch
              id="auto-approval"
              checked={settings.autoApproval}
              onCheckedChange={(checked) => 
                setSettings({ ...settings, autoApproval: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Google PSE Search Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Manual Discovery
          </CardTitle>
          <CardDescription>
            Run custom discovery searches using Google PSE
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DiscoverySearchInterface />
        </CardContent>
      </Card>

      {/* Save Settings */}
      <div className="flex justify-end">
        <Button onClick={saveSettings} className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}