-- subscribe.lua — Triple change subscription streaming service
--
-- Registers core:SubscribeTriples as a service that accepts a callback.
-- Uses the same pattern as CreativeWritingStream: the callback is passed
-- as an input parameter and called for each event.

Service:define()
  :namespace("core")
  :name("SubscribeTriples")
  :desc("Subscribe to triple store changes. Pushes snapshot + incremental ChangeEvent[] via callback.")
  :inputs(Type.Object({
    callback = Type.Any:desc("Callback function called for each change event"),
  }))
  :outputs(Type.Nil)
  :impl(function(inputs)
    -- State:subscribeChanges() returns a JS async generator.
    -- Each iteration yields to JS (allowing other Lua tasks to run),
    -- then resumes when the next change event arrives.
    for event in State:subscribeChanges() do
      inputs.callback(event)
    end
  end)
