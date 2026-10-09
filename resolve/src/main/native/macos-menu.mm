#import <AppKit/AppKit.h>
#import <dispatch/dispatch.h>
#include <stdint.h>

static void ApplyMenuTitle(void) {
  if (![NSThread isMainThread] || NSApp.mainMenu.numberOfItems == 0) return;
  NSMenuItem *item = [NSApp.mainMenu itemAtIndex:0];
  if (!item || !item.submenu) return;
  NSProcessInfo.processInfo.processName = @"SoundDesigner";
  item.title = @"SoundDesigner";
  item.submenu.title = @"SoundDesigner";
}

// Node-API's opaque registration ABI; no V8/Electron headers or JS bindings are needed.
struct napi_env__;
struct napi_value__;
extern "C" __attribute__((visibility("default"))) int32_t node_api_module_get_api_version_v1(void) { return 1; }
extern "C" __attribute__((visibility("default"))) napi_value__ *napi_register_module_v1(napi_env__ *, napi_value__ *exports) {
  static id observer;
  dispatch_async(dispatch_get_main_queue(), ^{
    ApplyMenuTitle();
    if (!observer) {
      observer = [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
        object:NSApp queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *notification) {
          dispatch_async(dispatch_get_main_queue(), ^{ ApplyMenuTitle(); });
        }];
    }
  });
  return exports;
}

#ifdef SOUNDDESIGNER_MENU_TEST
#include <assert.h>
#include <stdio.h>
int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSMenu *menu = [NSMenu new];
    NSMenuItem *application = [[NSMenuItem alloc] initWithTitle:@"Electron" action:nil keyEquivalent:@""];
    application.submenu = [[NSMenu alloc] initWithTitle:@"Electron"];
    NSMenuItem *edit = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
    [menu addItem:application];
    [menu addItem:edit];
    NSApp.mainMenu = menu;
    for (int refresh = 0; refresh < 2; refresh++) {
      application.title = @"Electron";
      application.submenu.title = @"Electron";
      if (refresh == 0) napi_register_module_v1(nullptr, nullptr);
      else [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidBecomeActiveNotification object:NSApp];
      NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1];
      while (![application.submenu.title isEqualToString:@"SoundDesigner"] && deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
      }
      assert([application.title isEqualToString:@"SoundDesigner"]);
      assert([application.submenu.title isEqualToString:@"SoundDesigner"]);
      assert([edit.title isEqualToString:@"Edit"]);
      assert([NSProcessInfo.processInfo.processName isEqualToString:@"SoundDesigner"]);
    }
    NSApp.mainMenu = nil;
    ApplyMenuTitle();
    NSApp.mainMenu = [NSMenu new];
    ApplyMenuTitle();
    puts("Native AppKit menu-title regression passed (not Resolve-host verification).");
  }
  return 0;
}
#endif
