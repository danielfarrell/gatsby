// @flow
import Joi from "joi"
import chalk from "chalk"
const _ = require(`lodash`)
const { bindActionCreators } = require(`redux`)
const { stripIndent } = require(`common-tags`)
const glob = require(`glob`)
const path = require(`path`)

const { joinPath } = require(`../utils/path`)
const { createUuid } = require(`../utils/uuid`)
const {
  getNode,
  hasNodeChanged,
  trackSubObjectsToRootNodeId,
} = require(`./index`)
const { store } = require(`./index`)
import * as joiSchemas from "../joi-schemas/joi"
import { generateComponentChunkName } from "../utils/js-chunk-names"

const actions = {}

type Job = {
  id: string,
}
type PageInput = {
  path: string,
  component: string,
  layout?: string,
  context?: Object,
}
type LayoutInput = {
  id?: string,
  machineId?: string,
  component: string,
  layout?: string,
  context?: Object,
}

type Page = {
  path: string,
  matchPath: ?string,
  component: string,
  context: Object,
  internalComponentName: string,
  jsonName: string,
  componentChunkName: string,
  layout: ?string,
  updatedAt: number,
}

type Layout = {
  id: any,
  context: Object,
  component: string,
  componentWrapperPath: string,
  componentChunkName: string,
  internalComponentName: string,
  jsonName: string,
  isLayout: true,
}

type Plugin = {
  name: string,
}

/**
 * Delete a page
 * @param {Object} page a page object with at least the path set
 * @param {string} page.path The path of the page
 * @param {string} page.component The absolute path to the page component
 * @example
 * deletePage(page)
 */
actions.deletePage = (page: PageInput) => {
  return {
    type: `DELETE_PAGE`,
    payload: page,
  }
}

const pascalCase = _.flow(_.camelCase, _.upperFirst)
/**
 * Create a page. See [the guide on creating and modifying pages](/docs/creating-and-modifying-pages/)
 * for detailed documenation about creating pages.
 * @param {Object} page a page object
 * @param {string} page.path Any valid URL. Must start with a forward slash
 * @param {string} page.component The absolute path to the component for this page
 * @param {Object} page.context Context data for this page. Passed as props
 * to the component `this.props.pathContext` as well as to the graphql query
 * as graphql arguments.
 * @example
 * createPage({
 *   path: `/my-sweet-new-page/`,
 *   component: path.resolve(`./src/templates/my-sweet-new-page.js`),
 *   // If you have a layout component at src/layouts/blog-layout.js
 *   layout: `blog-layout`,
 *   // The context is passed as props to the component as well
 *   // as into the component's GraphQL query.
 *   context: {
 *     id: `123456`,
 *   },
 * })
 */
actions.createPage = (page: PageInput, plugin?: Plugin, traceId?: string) => {
  let jsonName = `${_.kebabCase(page.path)}.json`
  let internalComponentName = `Component${pascalCase(page.path)}`

  if (jsonName === `.json`) {
    jsonName = `index.json`
    internalComponentName = `ComponentIndex`
  }
  let layout = page.layout || null
  // If no layout is set we try fallback to `/src/layouts/index`.
  if (
    !layout &&
    glob.sync(
      joinPath(store.getState().program.directory, `src/layouts/index.*`)
    ).length
  ) {
    layout = `index`
  }

  let internalPage: Page = {
    layout,
    jsonName,
    internalComponentName,
    path: page.path,
    matchPath: page.matchPath,
    component: page.component,
    componentChunkName: generateComponentChunkName(page.component),
    // Ensure the page has a context object
    context: page.context || {},
    updatedAt: Date.now(),
  }

  // If the path doesn't have an initial forward slash, add it.
  if (internalPage.path[0] !== `/`) {
    internalPage.path = `/${internalPage.path}`
  }

  const result = Joi.validate(internalPage, joiSchemas.pageSchema)
  if (result.error) {
    console.log(chalk.blue.bgYellow(`The upserted page didn't pass validation`))
    console.log(chalk.bold.red(result.error))
    console.log(internalPage)
    return null
  }

  return {
    type: `CREATE_PAGE`,
    plugin,
    traceId,
    payload: internalPage,
  }
}

/**
 * Delete a layout
 * @param {string} layout a layout object with at least the name set
 * @example
 * deleteLayout(layout)
 */
actions.deleteLayout = (layout: Layout, plugin?: Plugin) => {
  return {
    type: `DELETE_LAYOUT`,
    payload: layout,
  }
}

/**
 * Create a layout. Generally layouts are created automatically by placing a
 * React component in the `src/layouts/` directory. This action should be used
 * if loading layouts from an NPM package or from a non-standard location.
 * @param {Object} layout a layout object
 * @param {string} layout.component The absolute path to the component for this layout
 * @example
 * createLayout({
 *   component: path.resolve(`./src/templates/myNewLayout.js`),
 *   id: 'custom-id', // If no id is provided, the filename will be used as id.
 *   context: {
 *     title: `My New Layout`
 *   }
 * })
 */
actions.createLayout = (
  layout: LayoutInput,
  plugin?: Plugin,
  traceId?: string
) => {
  let id = layout.id || path.parse(layout.component).name
  // Add a "machine" id as a universal ID to differentiate layout from
  // page components.
  const machineId = `layout---${id}`
  let componentWrapperPath = joinPath(
    store.getState().program.directory,
    `.cache`,
    `layouts`,
    `${id}.js`
  )

  let internalLayout: Layout = {
    id,
    machineId,
    componentWrapperPath,
    isLayout: true,
    jsonName: `layout-${_.kebabCase(id)}.json`,
    internalComponentName: `Component-layout-${pascalCase(id)}`,
    component: layout.component,
    componentChunkName: generateComponentChunkName(layout.component),
    // Ensure the page has a context object
    context: layout.context || {},
  }

  const result = Joi.validate(internalLayout, joiSchemas.layoutSchema)

  if (result.error) {
    console.log(
      chalk.blue.bgYellow(`The upserted layout didn't pass validation`)
    )
    console.log(chalk.bold.red(result.error))
    console.log(internalLayout)
    return null
  }

  return {
    type: `CREATE_LAYOUT`,
    plugin,
    traceId,
    payload: internalLayout,
  }
}

/**
 * Delete a node
 * @param {string} nodeId a node id
 * @param {object} node the node object
 * @example
 * deleteNode(node.id, node)
 */
actions.deleteNode = (nodeId: string, node: any, plugin: Plugin) => {
  return {
    type: `DELETE_NODE`,
    plugin,
    node,
    payload: nodeId,
  }
}

/**
 * Batch delete nodes
 * @param {Array} nodes an array of node ids
 * @example
 * deleteNodes([`node1`, `node2`])
 */
actions.deleteNodes = (nodes: any[], plugin: Plugin) => {
  return {
    type: `DELETE_NODES`,
    plugin,
    payload: nodes,
  }
}

const typeOwners = {}
/**
 * Create a new node.
 * @param {Object} node a node object
 * @param {string} node.id The node's ID. Must be globally unique.
 * @param {string} node.parent The ID of the parent's node. If the node is
 * derived from another node, set that node as the parent. Otherwise it can
 * just be an empty string.
 * @param {Array} node.children An array of children node IDs. If you're
 * creating the children nodes while creating the parent node, add the
 * children node IDs here directly. If you're adding a child node to a
 * parent node created by a plugin, you can't mutate this value directly
 * to add your node id, instead use the action creator `createParentChildLink`.
 * @param {Object} node.internal node fields that aren't generally
 * interesting to consumers of node data but are very useful for plugin writers
 * and Gatsby core.
 * @param {string} node.internal.mediaType An optional field to indicate to
 * transformer plugins that your node has raw content they can transform.
 * Use either an official media type (we use mime-db as our source
 * (https://www.npmjs.com/package/mime-db) or a made-up one if your data
 * doesn't fit in any existing bucket. Transformer plugins use node media types
 * for deciding if they should transform a node into a new one. E.g.
 * markdown transformers look for media types of
 * `text/markdown`.
 * @param {string} node.internal.type An arbitrary globally unique type
 * choosen by the plugin creating the node. Should be descriptive of the
 * node as the type is used in forming GraphQL types so users will query
 * for nodes based on the type choosen here. Nodes of a given type can
 * only be created by one plugin.
 * @param {string} node.internal.content An optional field. The raw content
 * of the node. Can be excluded if it'd require a lot of memory to load in
 * which case you must define a `loadNodeContent` function for this node.
 * @param {string} node.internal.contentDigest the digest for the content
 * of this node. Helps Gatsby avoid doing extra work on data that hasn't
 * changed.
 * @example
 * createNode({
 *   // Data for the node.
 *   field1: `a string`,
 *   field2: 10,
 *   field3: true,
 *   ...arbitraryOtherData,
 *
 *   // Required fields.
 *   id: `a-node-id`,
 *   parent: `the-id-of-the-parent-node`, // or null if it's a source node without a parent
 *   children: [],
 *   internal: {
 *     type: `CoolServiceMarkdownField`,
 *     contentDigest: crypto
 *       .createHash(`md5`)
 *       .update(JSON.stringify(fieldData))
 *       .digest(`hex`),
 *     mediaType: `text/markdown`, // optional
 *     content: JSON.stringify(fieldData), // optional
 *   }
 * })
 */
actions.createNode = (node: any, plugin?: Plugin, traceId?: string) => {
  if (!_.isObject(node)) {
    return console.log(
      chalk.bold.red(
        `The node passed to the "createNode" action creator must be an object`
      )
    )
  }

  // Ensure the new node has an internals object.
  if (!node.internal) {
    node.internal = {}
  }

  // Tell user not to set the owner name themself.
  if (node.internal.owner) {
    console.log(JSON.stringify(node, null, 4))
    console.log(
      chalk.bold.red(
        `The node internal.owner field is set automatically by Gatsby and not by plugin`
      )
    )
    process.exit(1)
  }

  // Add the plugin name to the internal object and generate uuid for the id
  if (plugin) {
    node.internal.owner = plugin.name
    node.id = createUuid(node.id, plugin.name)
  }

  const result = Joi.validate(node, joiSchemas.nodeSchema)
  if (result.error) {
    console.log(chalk.bold.red(`The new node didn't pass validation`))
    console.log(chalk.bold.red(result.error))
    console.log(node)
    return { type: `VALIDATION_ERROR`, error: true }
  }

  // Ensure node isn't directly setting fields.
  if (node.fields) {
    throw new Error(
      stripIndent`
      Plugins creating nodes can not set data on the reserved field "fields"
      as this is reserved for plugins which wish to extend your nodes.

      If your plugin didn't add "fields" you're probably seeing this
      error because you're reusing an old node object.

      Node:

      ${JSON.stringify(node, null, 4)}

      Plugin that created the node:

      ${JSON.stringify(plugin, null, 4)}
    `
    )
  }

  trackSubObjectsToRootNodeId(node)

  const oldNode = getNode(node.id)

  // Ensure the plugin isn't creating a node type owned by another
  // plugin. Type "ownership" is first come first served.
  if (plugin) {
    let pluginName = plugin.name

    if (!typeOwners[node.internal.type])
      typeOwners[node.internal.type] = pluginName
    else if (typeOwners[node.internal.type] !== pluginName)
      throw new Error(stripIndent`
        The plugin "${pluginName}" created a node of a type owned by another plugin.

        The node type "${node.internal.type}" is owned by "${
        typeOwners[node.internal.type]
      }".

        If you copy and pasted code from elsewhere, you'll need to pick a new type name
        for your new node(s).

        The node object passed to "createNode":

        ${JSON.stringify(node, null, 4)}

        The plugin creating the node:

        ${JSON.stringify(plugin, null, 4)}
      `)

    // If the node has been created in the past, check that
    // the current plugin is the same as the previous.
    if (oldNode && oldNode.internal.owner !== pluginName) {
      throw new Error(
        stripIndent`
        Nodes can only be updated by their owner. Node "${node.id}" is
        owned by "${oldNode.internal.owner}" and another plugin "${pluginName}"
        tried to update it.

        `
      )
    }
  }

  // Check if the node has already been processed.
  if (oldNode && !hasNodeChanged(node.id, node.internal.contentDigest)) {
    return {
      type: `TOUCH_NODE`,
      plugin,
      traceId,
      payload: node.id,
    }
  } else {
    return {
      type: `CREATE_NODE`,
      plugin,
      traceId,
      payload: node,
    }
  }
}

/**
 * "Touch" a node. Tells Gatsby a node still exists and shouldn't
 * be garbage collected. Primarily useful for source plugins fetching
 * nodes from a remote system that can return only nodes that have
 * updated. The source plugin then touches all the nodes that haven't
 * updated but still exist so Gatsby knows to keep them.
 * @param {string} nodeId The id of a node.
 * @example
 * touchNode(`a-node-id`)
 */
actions.touchNode = (nodeId: string, plugin?: Plugin) => {
  return {
    type: `TOUCH_NODE`,
    plugin,
    payload: nodeId,
  }
}

type CreateNodeInput = {
  node: Object,
  fieldName?: string,
  fieldValue?: string,
  name?: string,
  value: any,
}
/**
 * Extend another node. The new node field is placed under the `fields`
 * key on the extended node object.
 *
 * Once a plugin has claimed a field name the field name can't be used by
 * other plugins.  Also since node's are immutable, you can't mutate the node
 * directly. So to extend another node, use this.
 * @param {Object} $0
 * @param {Object} $0.node the target node object
 * @param {string} $0.fieldName [deprecated] the name for the field
 * @param {string} $0.fieldValue [deprecated] the value for the field
 * @param {string} $0.name the name for the field
 * @param {string} $0.value the value for the field
 * @example
 * createNodeField({
 *   node,
 *   name: `happiness`,
 *   value: `is sweet graphql queries`
 * })
 *
 * // The field value is now accessible at node.fields.happiness
 */
actions.createNodeField = (
  { node, name, value, fieldName, fieldValue }: CreateNodeInput,
  plugin: Plugin,
  traceId?: string
) => {
  if (fieldName) {
    console.warn(
      `Calling "createNodeField" with "fieldName" is deprecated. Use "name" instead`
    )
    if (!name) {
      name = fieldName
    }
  }
  if (fieldValue) {
    console.warn(
      `Calling "createNodeField" with "fieldValue" is deprecated. Use "value" instead`
    )
    if (!value) {
      value = fieldValue
    }
  }
  // Ensure required fields are set.
  if (!node.internal.fieldOwners) {
    node.internal.fieldOwners = {}
  }
  if (!node.fields) {
    node.fields = {}
  }

  // Check that this field isn't owned by another plugin.
  const fieldOwner = node.internal.fieldOwners[name]
  if (fieldOwner && fieldOwner !== plugin.name) {
    throw new Error(
      stripIndent`
      A plugin tried to update a node field that it doesn't own:

      Node id: ${node.id}
      Plugin: ${plugin.name}
      name: ${name}
      value: ${value}
      `
    )
  }

  // Update node
  node.fields[name] = value
  node.internal.fieldOwners[name] = plugin.name

  return {
    type: `ADD_FIELD_TO_NODE`,
    plugin,
    traceId,
    payload: node,
  }
}

/**
 * Creates a link between a parent and child node
 * @param {Object} $0
 * @param {Object} $0.parent the parent node object
 * @param {Object} $0.child the child node object
 * @example
 * createParentChildLink({ parent: parentNode, child: childNode })
 */
actions.createParentChildLink = (
  { parent, child }: { parent: any, child: any },
  plugin?: Plugin
) => {
  // Update parent
  parent.children.push(child.id)
  parent.children = _.uniq(parent.children)

  return {
    type: `ADD_CHILD_NODE_TO_PARENT_NODE`,
    plugin,
    payload: parent,
  }
}

/**
 * Create a dependency between a page and data. Probably for
 * internal use only.
 * @param {Object} $0
 * @param {string} $0.path the path to the page
 * @param {string} $0.nodeId A node ID
 * @param {string} $0.connection A connection type
 * @private
 */
actions.createPageDependency = (
  {
    path,
    nodeId,
    connection,
  }: { path: string, nodeId: string, connection: string },
  plugin: string = ``
) => {
  return {
    type: `CREATE_COMPONENT_DEPENDENCY`,
    plugin,
    payload: {
      path,
      nodeId,
      connection,
    },
  }
}

/**
 * Delete dependencies between an array of pages and data. Probably for
 * internal use only. Used when deleting pages.
 * @param {Array} paths the paths to delete.
 * @private
 */
actions.deleteComponentsDependencies = (paths: string[]) => {
  return {
    type: `DELETE_COMPONENTS_DEPENDENCIES`,
    payload: {
      paths,
    },
  }
}

/**
 * When the query watcher extracts a graphq query, it calls
 * this to store the query with its component.
 * @private
 */
actions.replaceComponentQuery = ({
  query,
  componentPath,
}: {
  query: string,
  componentPath: string,
}) => {
  return {
    type: `REPLACE_COMPONENT_QUERY`,
    payload: {
      query,
      componentPath,
    },
  }
}

/**
 * Merge additional configuration into the current webpack config. A few
 * configurations options will be ignored if set, in order to try prevent accidental breakage.
 * Specifically, any change to `entry`, `output`, `target`, or `resolveLoaders` will be ignored.
 *
 * For full control over the webpack config, use `replaceWebpackConfig()`.
 *
 * @param {Object} config partial webpack config, to be merged into the current one
 */
actions.setWebpackConfig = (config: Object) => {
  return {
    type: `SET_WEBPACK_CONFIG`,
    payload: config,
  }
}

/**
 * Completely replace the webpack config for the current stage. This can be
 * dangerous and break Gatsby if certain configuration options are changed.
 *
 * Generally only useful for cases where you need to handle config merging logic
 * yourself, in which case consider using `webpack-merge`.
 *
 * @param {Object} config complete webpack config
 */
actions.replaceWebpackConfig = (config: Object) => {
  return {
    type: `REPLACE_WEBPACK_CONFIG`,
    payload: config,
  }
}

/**
 * Create a "job". This is a long-running process that are generally
 * started as side-effects to GraphQL queries.
 * [`gatsby-plugin-sharp`](/packages/gatsby-plugin-sharp/) uses this for
 * example.
 *
 * Gatsby doesn't finish its bootstrap until all jobs are ended.
 * @param {Object} job A job object with at least an id set
 * @param {id} job.id The id of the job
 * @example
 * createJob({ id: `write file id: 123`, fileName: `something.jpeg` })
 */
actions.createJob = (job: Job, plugin?: ?Plugin = null) => {
  return {
    type: `CREATE_JOB`,
    plugin,
    payload: job,
  }
}

/**
 * Set (update) a "job". Sometimes on really long running jobs you want
 * to update the job as it continues.
 *
 * @param {Object} job A job object with at least an id set
 * @param {id} job.id The id of the job
 * @example
 * setJob({ id: `write file id: 123`, progress: 50 })
 */
actions.setJob = (job: Job, plugin?: ?Plugin = null) => {
  return {
    type: `SET_JOB`,
    plugin,
    payload: job,
  }
}

/**
 * End a "job".
 *
 * Gatsby doesn't finish its bootstrap until all jobs are ended.
 * @param {Object} job  A job object with at least an id set
 * @param {id} job.id The id of the job
 * @example
 * endJob({ id: `write file id: 123` })
 */
actions.endJob = (job: Job, plugin?: ?Plugin = null) => {
  return {
    type: `END_JOB`,
    plugin,
    payload: job,
  }
}

/**
 * Set plugin status. A plugin can use this to save status keys e.g. the last
 * it fetched something. These values are persisted between runs of Gatsby.
 *
 * @param {Object} status  An object with arbitrary values set
 * @example
 * setPluginStatus({ lastFetched: Date.now() })
 */
actions.setPluginStatus = (
  status: { [key: string]: mixed },
  plugin: Plugin
) => {
  return {
    type: `SET_PLUGIN_STATUS`,
    plugin,
    payload: status,
  }
}

/**
 * Create a redirect from one page to another.  Redirect data can be used to
 * configure hosting environments like Netlify (automatically handled with the
 * [Netlify plugin](/packages/gatsby-plugin-netlify/)).
 *
 * @param {Object} redirect Redirect data
 * @param {string} redirect.fromPath Any valid URL. Must start with a forward slash
 * @param {string} redirect.isPermanent This is a permanent redirect; defaults to temporary
 * @param {string} redirect.toPath URL of a created page (see `createPage`)
 * @param {string} redirect.redirectInBrowser Redirects are generally for redirecting legacy URLs to their new configuration. If you can't update your UI for some reason, set `redirectInBrowser` to true and Gatsby will handle redirecting in the client as well.
 * @example
 * createRedirect({ fromPath: '/old-url', toPath: '/new-url', isPermanent: true })
 * createRedirect({ fromPath: '/url', toPath: '/zn-CH/url', Language: 'zn' })
 */
actions.createRedirect = ({
  fromPath,
  isPermanent = false,
  redirectInBrowser = false,
  toPath,
  ...rest
}) => {
  let pathPrefix = ``
  if (store.getState().program.prefixPaths) {
    pathPrefix = store.getState().config.pathPrefix
  }

  return {
    type: `CREATE_REDIRECT`,
    payload: {
      fromPath: `${pathPrefix}${fromPath}`,
      isPermanent,
      redirectInBrowser,
      toPath: `${pathPrefix}${toPath}`,
      ...rest,
    },
  }
}

exports.actions = actions
exports.boundActionCreators = bindActionCreators(actions, store.dispatch)
