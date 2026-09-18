// Exact luaCodeWrapper excerpts from RisuAI e565563a, scriptings.ts:1259-1373 (GPL-3.0).
export const risuSource = 'https://github.com/kwaroran/RisuAI/blob/e565563a288ebe4c65b6099a1645ba477d1c84b4/src/ts/process/scriptings.ts';
export const risuJsonSha256 = 'a3c0a1693143a6a2aa4a55329733f55f7c1cff28bc3795b66623822c52a4d7a3';
export const risuWrapperSlices: readonly (readonly [string, string])[] = [
  [
    "function getRecentChats",
    "function setFullChat"
  ],
  [
    "function getState",
    "function async"
  ],
  [
    "function async",
    "callListenMain = async"
  ]
];
export const risuPrelude = `json = require "json"

function getRecentChats(id, count)
    return json.decode(getRecentChatsMain(id, count))
end


function getState(id, name)
    local escapedName = "__"..name
    return json.decode(getChatVar(id, escapedName))
end

function setState(id, name, value)
    local escapedName = "__"..name
    setChatVar(id, escapedName, json.encode(value))
end

function setStateChanged(id, name, value)
    local escapedName = "__"..name
    return setChatVarChanged(id, escapedName, json.encode(value))
end


function async(callback)
    return function(...)
        local co = coroutine.create(callback)
        local safe, result = coroutine.resume(co, ...)

        return Promise.create(function(resolve, reject)
            local checkresult
            local step = function()
                if coroutine.status(co) == "dead" then
                    local send = safe and resolve or reject
                    return send(result)
                end

                safe, result = coroutine.resume(co)
                checkresult()
            end

            checkresult = function()
                if safe and result == Promise.resolve(result) then
                    result:finally(step)
                else
                    step()
                end
            end

            checkresult()
        end)
    end
end

`;
