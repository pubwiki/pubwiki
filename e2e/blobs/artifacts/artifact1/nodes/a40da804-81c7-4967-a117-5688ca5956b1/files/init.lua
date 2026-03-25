Service = require("core/service")
Type = require("core/types")
ServiceRegistry = Service 
Loader = require("./loader")
Regex = require("./regex")
require("./save")
local ok, errors = Loader.load("/user/backend/assets")

if not ok then
  error("Failed to load modules: " .. table.concat(errors or {}, ", "))
end

